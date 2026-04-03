import { cp, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import type { TaskRecord } from "@monitor/contracts";

function shouldNotify(status: TaskRecord["status"]): boolean {
  return (
    status === "waiting_input" ||
    status === "waiting_approval" ||
    status === "finished" ||
    status === "error"
  );
}

function resolveBundledNotifierAppDir(): string {
  const require = createRequire(import.meta.url);
  const notifierPackageDir = dirname(require.resolve("terminal-notifier"));
  return join(notifierPackageDir, "terminal-notifier.app");
}

export function isNotificationSupported(
  platform: NodeJS.Platform = process.platform
): boolean {
  return platform === "darwin";
}

export function shouldNotifyTaskUpdate(
  previous: TaskRecord | undefined,
  next: TaskRecord,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (!isNotificationSupported(platform) || !shouldNotify(next.status)) {
    return false;
  }

  return previous?.status !== next.status;
}

function buildMessage(task: TaskRecord): string {
  if (task.status === "finished") {
    return `${task.name} finished`;
  }

  if (task.status === "error") {
    return `${task.name} failed`;
  }

  if (task.status === "waiting_approval") {
    return `${task.name} needs approval`;
  }

  return `${task.name} needs input`;
}

export async function notifyTask(task: TaskRecord): Promise<void> {
  if (!shouldNotifyTaskUpdate(undefined, task)) {
    return;
  }

  const bundledNotifierAppDir = resolveBundledNotifierAppDir();
  const tempAppDir = await mkdtemp(join(tmpdir(), "monitor-terminal-notifier-"));

  try {
    const copiedAppDir = `${tempAppDir}.app`;
    await cp(bundledNotifierAppDir, copiedAppDir, { recursive: true });

    await new Promise<void>((resolve, reject) => {
      const child = spawn(join(copiedAppDir, "Contents", "MacOS", "terminal-notifier"), [
        "-title",
        "Monitor",
        "-message",
        buildMessage(task),
        "-group",
        task.taskId,
        "-open",
        `monitor://task/${task.taskId}`
      ]);

      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`terminal-notifier exited with code ${String(code)}`));
      });
    });
  } finally {
    await rm(tempAppDir, { recursive: true, force: true }).catch(() => undefined);
    await rm(`${tempAppDir}.app`, { recursive: true, force: true }).catch(
      () => undefined
    );
  }
}
