import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { TaskEvent, TaskRecord } from "@monitor/contracts";
import { DaemonClient } from "../lib/http-client.js";
import { buildCodexCommand, detectCodexWaitState } from "../lib/adapters/codex.js";
import { detectHostMetadata } from "../lib/host-metadata.js";

const DEFAULT_DAEMON_URL = "http://127.0.0.1:45731";

function parseNameArg(args: string[]): { name: string; remainingArgs: string[] } {
  const nameIndex = args.indexOf("--name");
  if (nameIndex < 0) return { name: "", remainingArgs: [...args] };

  const name = args[nameIndex + 1] ?? "";
  const remainingArgs = [...args];
  remainingArgs.splice(nameIndex, name ? 2 : 1);
  return { name, remainingArgs };
}

async function main(): Promise<void> {
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

  const client = new DaemonClient(daemonUrl);
  let eventQueue = Promise.resolve();
  const enqueueEvent = (event: TaskEvent): void => {
    eventQueue = eventQueue.then(() => client.postEvent(event));
  };

  enqueueEvent({
    type: "task.started",
    taskId,
    at: startedAt,
    payload: task
  });

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    process.stdout.write(chunk);
    const waitState = detectCodexWaitState(chunk);
    const at = new Date().toISOString();
    if (waitState) {
      enqueueEvent({ type: `task.${waitState}`, taskId, at } as TaskEvent);
      return;
    }
    enqueueEvent({ type: "task.output", taskId, at, payload: { chunk } });
  });

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    process.stderr.write(chunk);
    enqueueEvent({
      type: "task.output",
      taskId,
      at: new Date().toISOString(),
      payload: { chunk }
    });
  });

  child.on("error", (error) => {
    enqueueEvent({
      type: "task.error",
      taskId,
      at: new Date().toISOString(),
      payload: { message: `failed to spawn codex: ${String(error)}` }
    });
  });

  child.on("exit", async (code) => {
    if (code && code !== 0) {
      enqueueEvent({
        type: "task.error",
        taskId,
        at: new Date().toISOString(),
        payload: { message: `codex exited with code ${code}` }
      });
    }

    try {
      await eventQueue;
      process.exit(code ?? 0);
    } catch (error) {
      process.stderr.write(`failed to post task event: ${String(error)}\n`);
      process.exit(1);
    }
  });
}

main().catch((error) => {
  process.stderr.write(String(error) + "\n");
  process.exit(1);
});
