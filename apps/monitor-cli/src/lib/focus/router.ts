import type { TaskRecord } from "@monitor/contracts";
import { iTermScript, terminalScript } from "./apple-script.js";

type FocusTarget = Pick<TaskRecord, "hostApp" | "hostWindowRef" | "hostSessionRef">;

export function buildFocusScript(task: FocusTarget): string {
  if (task.hostApp === "terminal") {
    return terminalScript(task.hostWindowRef, task.hostSessionRef);
  }

  if (task.hostApp === "iterm2") {
    return iTermScript(task.hostWindowRef, task.hostSessionRef);
  }

  throw new Error(`unsupported host app: ${task.hostApp}`);
}
