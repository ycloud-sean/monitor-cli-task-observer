import { execFile, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import type { TaskRecord } from "@monitor/contracts";
import { buildFocusScript } from "./focus/router.js";
import { parseCursorWindowRef } from "./focus/cursor-window.js";

const WAITING_ALERT_SOUND_PLAYER = "/usr/bin/afplay";
const WAITING_ALERT_SOUND_FILE = "/System/Library/Sounds/Glass.aiff";
const execFileAsync = promisify(execFile);

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

function buildFrontmostProcessCheck(processName: string): string[] {
  return [
    "-e",
    'tell application "System Events"',
    "-e",
    `if not (exists process ${quoteAppleScriptString(processName)}) then return "false"`,
    "-e",
    `if not (frontmost of process ${quoteAppleScriptString(processName)}) then return "false"`,
    "-e",
    "end tell"
  ];
}

async function isTaskVisibleInFront(task: TaskRecord): Promise<boolean> {
  if (task.hostApp === "terminal") {
    if (task.hostSessionRef) {
      try {
        const { stdout } = await execFileAsync("osascript", [
          ...buildFrontmostProcessCheck("Terminal"),
          "-e",
          'tell application "Terminal"',
          "-e",
          "if not running then return \"false\"",
          "-e",
          'if (count of windows) is 0 then return "false"',
          "-e",
          'try',
          "-e",
          `return (tty of selected tab of front window as text) is ${quoteAppleScriptString(task.hostSessionRef)}`,
          "-e",
          'on error',
          "-e",
          'return "false"',
          "-e",
          "end try",
          "-e",
          "end tell"
        ]);
        return String(stdout).trim() === "true";
      } catch {
        return false;
      }
    }

    if (task.hostWindowRef && /^\d+$/.test(task.hostWindowRef)) {
      try {
        const { stdout } = await execFileAsync("osascript", [
          ...buildFrontmostProcessCheck("Terminal"),
          "-e",
          'tell application "Terminal"',
          "-e",
          "if not running then return \"false\"",
          "-e",
          'if (count of windows) is 0 then return "false"',
          "-e",
          `return (id of front window as text) is ${quoteAppleScriptString(task.hostWindowRef)}`,
          "-e",
          "end tell"
        ]);
        return String(stdout).trim() === "true";
      } catch {
        return false;
      }
    }

    return false;
  }

  if (task.hostApp === "iterm2") {
    if (!task.hostSessionRef) {
      return false;
    }

    try {
      const { stdout } = await execFileAsync("osascript", [
        ...buildFrontmostProcessCheck("iTerm2"),
        "-e",
        'tell application "iTerm2"',
        "-e",
        "if not running then return \"false\"",
        "-e",
        'if (count of windows) is 0 then return "false"',
        "-e",
        "tell current session of current tab of current window",
        "-e",
        `return (tty as text) is ${quoteAppleScriptString(task.hostSessionRef)}`,
        "-e",
        "end tell",
        "-e",
        "end tell"
      ]);
      return String(stdout).trim() === "true";
    } catch {
      return false;
    }
  }

  if (task.hostApp === "cursor") {
    const snapshot = parseCursorWindowRef(task.hostWindowRef);
    if (!snapshot) {
      return false;
    }

    try {
      const { stdout } = await execFileAsync("osascript", [
        ...buildFrontmostProcessCheck("Cursor"),
        "-e",
        'tell application "System Events"',
        "-e",
        'if not (exists process "Cursor") then return "false"',
        "-e",
        'tell process "Cursor"',
        "-e",
        'if (count of windows) is 0 then return "false"',
        "-e",
        "set targetWindow to front window",
        "-e",
        'set titleValue to ""',
        "-e",
        'set documentValue to ""',
        "-e",
        'try',
        "-e",
        'set titleValue to (value of attribute "AXTitle" of targetWindow as text)',
        "-e",
        "end try",
        "-e",
        'try',
        "-e",
        'set documentValue to (value of attribute "AXDocument" of targetWindow as text)',
        "-e",
        "end try",
        "-e",
        `return (titleValue is ${quoteAppleScriptString(snapshot.title ?? "")}) or (documentValue is ${quoteAppleScriptString(snapshot.document ?? "")})`,
        "-e",
        "end tell",
        "-e",
        "end tell"
      ]);
      return String(stdout).trim() === "true";
    } catch {
      return false;
    }
  }

  return false;
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
    if (await isTaskVisibleInFront(task)) {
      return;
    }
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
