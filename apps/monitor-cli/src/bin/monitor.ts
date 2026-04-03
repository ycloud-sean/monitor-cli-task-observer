import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants as osConstants } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import type { TaskEvent, TaskRecord } from "@monitor/contracts";
import { DaemonClient } from "../lib/http-client.js";
import { buildCodexCommand, detectCodexWaitState } from "../lib/adapters/codex.js";
import { detectHostMetadata } from "../lib/host-metadata.js";

const DEFAULT_DAEMON_URL = "http://127.0.0.1:45731";

export function parseNameArg(args: string[]): { name: string; remainingArgs: string[] } {
  const nameIndex = args.indexOf("--name");
  if (nameIndex < 0) return { name: "", remainingArgs: [...args] };

  const candidateName = args[nameIndex + 1] ?? "";
  const name = candidateName.startsWith("-") ? "" : candidateName;
  const remainingArgs = [...args];
  remainingArgs.splice(nameIndex, name ? 2 : 1);
  return { name, remainingArgs };
}

export function resolveProcessExitCode(
  code: number | null,
  signal: NodeJS.Signals | null
): number {
  if (typeof code === "number") return code;
  if (!signal) return 0;
  const signalCode = osConstants.signals[signal];
  return typeof signalCode === "number" ? 128 + signalCode : 1;
}

export function buildStreamEvents(
  taskId: string,
  chunk: string,
  carryover: string
): { events: TaskEvent[]; carryover: string } {
  const at = new Date().toISOString();
  const events: TaskEvent[] = [{ type: "task.output", taskId, at, payload: { chunk } }];
  const combined = `${carryover}${chunk}`.slice(-512);
  const waitState = detectCodexWaitState(combined);
  if (waitState) {
    events.push({ type: `task.${waitState}`, taskId, at } as TaskEvent);
    return { events, carryover: "" };
  }
  return { events, carryover: combined };
}

export function buildCloseEvents(
  taskId: string,
  code: number | null,
  signal: NodeJS.Signals | null
): { exitCode: number; events: TaskEvent[] } {
  const exitCode = resolveProcessExitCode(code, signal);
  if (exitCode === 0) {
    return {
      exitCode,
      events: [{ type: "task.finished", taskId, at: new Date().toISOString() }]
    };
  }

  const detail =
    signal && code === null
      ? `signal ${signal}`
      : `code ${typeof code === "number" ? code : exitCode}`;

  return {
    exitCode,
    events: [
      {
        type: "task.error",
        taskId,
        at: new Date().toISOString(),
        payload: { message: `codex exited with ${detail}` }
      }
    ]
  };
}

export function createEventQueue(
  postEvent: (event: TaskEvent) => Promise<void>,
  onError: (error: unknown) => void
): { enqueue: (event: TaskEvent) => void; drain: () => Promise<void> } {
  let eventQueue = Promise.resolve();
  const enqueue = (event: TaskEvent): void => {
    eventQueue = eventQueue
      .then(() => postEvent(event))
      .catch((error) => onError(error));
  };
  return { enqueue, drain: () => eventQueue };
}

export async function main(): Promise<void> {
  const daemonUrl = process.env.MONITOR_DAEMON_URL ?? DEFAULT_DAEMON_URL;
  const forwardedArgs = process.argv.slice(2);
  const [runner, ...runnerArgs] = forwardedArgs;

  if (runner !== "codex") {
    throw new Error("Task 4 only supports monitor codex");
  }

  const { name, remainingArgs } = parseNameArg(runnerArgs);
  const taskId = randomUUID();
  const displayName = name || `codex-${taskId.slice(0, 8)}`;
  const hookPath = join(dirname(fileURLToPath(import.meta.url)), "monitor-hook.js");

  const command = buildCodexCommand({
    taskId,
    daemonUrl,
    hookCommand: [process.execPath, hookPath],
    forwardedArgs: ["codex", ...remainingArgs]
  });

  const child = spawn(command[0], command.slice(1), {
    stdio: ["inherit", "pipe", "pipe"]
  });

  const client = new DaemonClient(daemonUrl);
  const eventQueue = createEventQueue((event) => client.postEvent(event), (error) => {
    process.stderr.write(`failed to post task event: ${String(error)}\n`);
  });
  const enqueueEvent = eventQueue.enqueue;
  let didSpawn = false;
  let hasExited = false;
  let stdoutCarryover = "";
  let stderrCarryover = "";
  const flushAndExit = (exitCode: number): void => {
    if (hasExited) return;
    hasExited = true;
    void eventQueue
      .drain()
      .then(() => process.exit(exitCode))
      .catch(() => process.exit(1));
  };

  child.on("spawn", () => {
    didSpawn = true;
    const startedAt = new Date().toISOString();
    const host = detectHostMetadata();
    const task: TaskRecord = {
      taskId,
      name: displayName,
      runnerType: "codex",
      rawCommand: command,
      cwd: process.cwd(),
      pid: child.pid ?? -1,
      hostApp: host.hostApp,
      hostWindowRef: host.hostWindowRef,
      hostSessionRef: host.hostSessionRef,
      startedAt,
      lastEventAt: startedAt,
      status: "running",
      lastOutputExcerpt: ""
    };
    enqueueEvent({
      type: "task.started",
      taskId,
      at: startedAt,
      payload: task
    });
  });

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    process.stdout.write(chunk);
    const result = buildStreamEvents(taskId, chunk, stdoutCarryover);
    stdoutCarryover = result.carryover;
    for (const event of result.events) {
      enqueueEvent(event);
    }
  });

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    process.stderr.write(chunk);
    const result = buildStreamEvents(taskId, chunk, stderrCarryover);
    stderrCarryover = result.carryover;
    for (const event of result.events) {
      enqueueEvent(event);
    }
  });

  child.on("error", (error) => {
    enqueueEvent({
      type: "task.error",
      taskId,
      at: new Date().toISOString(),
      payload: { message: `failed to spawn codex: ${String(error)}` }
    });
    if (!didSpawn) {
      flushAndExit(1);
    }
  });

  child.on("close", (code, signal) => {
    const result = buildCloseEvents(taskId, code, signal);
    for (const event of result.events) {
      enqueueEvent(event);
    }
    flushAndExit(result.exitCode);
  });
}

const isDirectExecution = process.argv[1]
  ? fileURLToPath(import.meta.url) === resolve(process.argv[1])
  : false;

if (isDirectExecution) {
  main().catch((error) => {
    process.stderr.write(String(error) + "\n");
    process.exit(1);
  });
}
