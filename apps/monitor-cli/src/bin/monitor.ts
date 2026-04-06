#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { constants as osConstants, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { TaskEvent, TaskRecord } from "@monitor/contracts";
import { buildClaudeSettings } from "../lib/adapters/claude.js";
import { isDirectExecution } from "../lib/bin-entry.js";
import { ensureDaemonRunning } from "../lib/daemon.js";
import { DaemonClient } from "../lib/http-client.js";
import {
  ensureCursorBridgeInstalled,
  installCursorBridge
} from "../lib/install/cursor-bridge.js";
import { buildCodexCommand, detectCodexWaitState } from "../lib/adapters/codex.js";
import { detectHostMetadata } from "../lib/host-metadata.js";
import { buildCursorBridgeUri } from "../lib/focus/cursor-bridge.js";
import { wrapCommandWithPty } from "../lib/pty.js";

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
  carryover: string,
  runner: TaskRecord["runnerType"] = "codex"
): { events: TaskEvent[]; carryover: string } {
  const at = new Date().toISOString();
  const events: TaskEvent[] = [{ type: "task.output", taskId, at, payload: { chunk } }];
  const combined = `${carryover}${chunk}`.slice(-512);
  const waitState = runner === "codex" ? detectCodexWaitState(combined) : null;
  if (waitState) {
    events.push({ type: `task.${waitState}`, taskId, at } as TaskEvent);
    return { events, carryover: "" };
  }
  return { events, carryover: combined };
}

export function buildCloseEvents(
  taskId: string,
  code: number | null,
  signal: NodeJS.Signals | null,
  runner: TaskRecord["runnerType"] = "codex"
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
        payload: { message: `${runner} exited with ${detail}` }
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

function openUriDetached(uri: string): void {
  const child = spawn("open", [uri], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

function printUsage(): void {
  process.stdout.write("用法:\n");
  process.stdout.write("  monitor <codex|claude> [args...]\n");
  process.stdout.write("  monitor install-cursor-bridge\n");
}

export function handleUtilityCommand(args: string[]): boolean {
  const [command, ...restArgs] = args;

  if (command === "install-cursor-bridge") {
    if (restArgs.length > 0) {
      throw new Error("install-cursor-bridge does not accept extra arguments");
    }

    const { targetDir } = installCursorBridge({
      moduleUrl: import.meta.url
    });
    process.stdout.write(`Cursor bridge 已安装到:\n  ${targetDir}\n`);
    process.stdout.write("如果 Cursor 正在运行，重启一次 Cursor，确保 bridge 扩展被加载。\n");
    return true;
  }

  if (command === "--help" || command === "-h" || command === "help") {
    printUsage();
    return true;
  }

  return false;
}

export async function main(): Promise<void> {
  const daemonUrl = process.env.MONITOR_DAEMON_URL ?? DEFAULT_DAEMON_URL;
  const forwardedArgs = process.argv.slice(2);
  if (handleUtilityCommand(forwardedArgs)) {
    return;
  }
  const [runner, ...runnerArgs] = forwardedArgs;

  if (runner !== "codex" && runner !== "claude") {
    printUsage();
    throw new Error(`unsupported runner: ${runner ?? ""}`);
  }
  const runnerType: TaskRecord["runnerType"] = runner;
  const host = detectHostMetadata();

  if (host.hostApp === "cursor") {
    try {
      const result = ensureCursorBridgeInstalled({
        moduleUrl: import.meta.url
      });
      if (result.installed) {
        const actionText = result.reason === "outdated" ? "更新" : "安装";
        process.stderr.write(
          `monitor: 已自动${actionText} Cursor bridge 到 ${result.targetDir}，请重启一次 Cursor。\n`
        );
      }
    } catch (error) {
      process.stderr.write(
        `monitor: 自动安装 Cursor bridge 失败，可稍后手动执行 monitor install-cursor-bridge: ${String(error)}\n`
      );
    }
  }

  await ensureDaemonRunning({
    baseUrl: daemonUrl,
    moduleUrl: import.meta.url
  });

  const { name, remainingArgs } = parseNameArg(runnerArgs);
  const taskId = randomUUID();
  const displayName = name || `${runnerType}-${taskId.slice(0, 8)}`;
  const hookPath = join(dirname(fileURLToPath(import.meta.url)), "monitor-hook.js");
  const baseHookCommand = [process.execPath, hookPath];
  let command: string[];

  if (runnerType === "codex") {
    command = buildCodexCommand({
      taskId,
      daemonUrl,
      hookCommand: baseHookCommand,
      forwardedArgs: ["codex", ...remainingArgs]
    });
  } else {
    const settings = buildClaudeSettings({
      taskId,
      daemonUrl,
      hookCommand: baseHookCommand
    });
    const settingsDir = mkdtempSync(join(tmpdir(), "monitor-claude-"));
    const settingsPath = join(settingsDir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    command = [
      "claude",
      "--settings",
      settingsPath,
      ...(name ? ["-n", name] : []),
      ...remainingArgs
    ];
  }

  const spawnCommand = wrapCommandWithPty(command);

  const child = spawn(spawnCommand[0], spawnCommand.slice(1), {
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
    if (host.hostApp === "cursor") {
      openUriDetached(
        buildCursorBridgeUri("register", {
          taskId,
          name: displayName,
          cwd: process.cwd(),
          monitorPid: String(process.pid)
        })
      );
    }
    const task: TaskRecord = {
      taskId,
      name: displayName,
      runnerType,
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
    const result = buildStreamEvents(taskId, chunk, stdoutCarryover, runnerType);
    stdoutCarryover = result.carryover;
    for (const event of result.events) {
      enqueueEvent(event);
    }
  });

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    process.stderr.write(chunk);
    const result = buildStreamEvents(taskId, chunk, stderrCarryover, runnerType);
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
      payload: { message: `failed to spawn ${runnerType}: ${String(error)}` }
    });
    if (!didSpawn) {
      flushAndExit(1);
    }
  });

  child.on("close", (code, signal) => {
    const result = buildCloseEvents(taskId, code, signal, runnerType);
    for (const event of result.events) {
      enqueueEvent(event);
    }
    flushAndExit(result.exitCode);
  });
}

if (isDirectExecution(fileURLToPath(import.meta.url), process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(String(error) + "\n");
    process.exit(1);
  });
}
