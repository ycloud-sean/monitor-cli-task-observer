import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import type { TaskRecord } from "@monitor/contracts";
import { buildFocusScript } from "./focus/router.js";

const WAITING_ALERT_SOUND_PLAYER = "/usr/bin/afplay";
const WAITING_ALERT_SOUND_FILE = "/System/Library/Sounds/Glass.aiff";

function shouldNotify(status: TaskRecord["status"]): boolean {
  return (
    status === "waiting_input" ||
    status === "waiting_approval" ||
    status === "finished" ||
    status === "error"
  );
}

function resolveBundledNotifierBinaryPath(): string {
  const require = createRequire(import.meta.url);
  const notifierPackageDir = dirname(require.resolve("terminal-notifier"));
  return join(
    notifierPackageDir,
    "terminal-notifier.app",
    "Contents",
    "MacOS",
    "terminal-notifier"
  );
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

function quoteAppleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function isWaitingTask(task: TaskRecord): boolean {
  return task.status === "waiting_input" || task.status === "waiting_approval";
}

function buildDialogTitle(task: TaskRecord): string {
  if (task.status === "waiting_approval") {
    return "Monitor 等待审批";
  }

  return "Monitor 等待输入";
}

function buildDialogMessage(task: TaskRecord): string {
  if (task.status === "waiting_approval") {
    return `任务“${task.name}”正在等待你审批。`;
  }

  return `任务“${task.name}”正在等待你输入。`;
}

function buildDialogScript(task: TaskRecord): string {
  const focusScript =
    task.hostApp === "unknown"
      ? ""
      : `
if button returned of dialogResult is "打开任务" then
${buildFocusScript(task)}
end if`;

  return `
tell application "System Events"
  activate
  set dialogResult to display dialog ${quoteAppleScriptString(buildDialogMessage(task))} with title ${quoteAppleScriptString(buildDialogTitle(task))} buttons {"忽略", "打开任务"} default button "打开任务"
end tell
${focusScript}
`.trim();
}

async function spawnDetached(
  command: string,
  args: string[],
  options: { detached?: boolean; stdio?: "ignore" } = {
    detached: true,
    stdio: "ignore"
  }
): Promise<void> {
  const child = spawn(command, args, {
    detached: options.detached ?? true,
    stdio: options.stdio ?? "ignore"
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const resolveOnSpawn = () => {
      if (settled) return;
      settled = true;
      child.off("error", rejectOnError);
      resolve();
    };

    const rejectOnError = (error: Error) => {
      if (settled) return;
      settled = true;
      child.off("spawn", resolveOnSpawn);
      reject(error);
    };

    child.once("spawn", resolveOnSpawn);
    child.once("error", rejectOnError);
  });

  child.unref();
}

async function playWaitingAlertSound(): Promise<void> {
  await spawnDetached(WAITING_ALERT_SOUND_PLAYER, [WAITING_ALERT_SOUND_FILE]);
}

export async function notifyTask(task: TaskRecord): Promise<void> {
  if (!shouldNotifyTaskUpdate(undefined, task)) {
    return;
  }

  if (isWaitingTask(task)) {
    await playWaitingAlertSound().catch(() => undefined);
    await spawnDetached("osascript", ["-e", buildDialogScript(task)]);
    return;
  }

  await spawnDetached(resolveBundledNotifierBinaryPath(), [
    "-title",
    "Monitor",
    "-message",
    buildMessage(task),
    "-group",
    task.taskId,
    "-open",
    `monitor://task/${task.taskId}`
  ]);
}
