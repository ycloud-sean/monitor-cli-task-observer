import type { TaskRecord } from "@monitor/contracts";
import { cursorScript } from "./cursor.js";
import { iTermScript, terminalScript } from "./apple-script.js";

type FocusTarget = Pick<
  TaskRecord,
  "taskId" | "hostApp" | "hostWindowRef" | "hostSessionRef" | "cwd"
>;

export function buildFocusScript(task: FocusTarget): string {
  if (task.hostApp === "terminal") {
    return terminalScript(task.hostWindowRef, task.hostSessionRef);
  }

  if (task.hostApp === "iterm2") {
    return iTermScript(task.hostWindowRef, task.hostSessionRef);
  }

  if (task.hostApp === "cursor") {
    return cursorScript(task.hostWindowRef, task.cwd, task.taskId);
  }

  throw new Error(`unsupported host app: ${task.hostApp}`);
}
