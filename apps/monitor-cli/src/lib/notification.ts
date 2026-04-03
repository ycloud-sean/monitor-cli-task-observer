import { spawn } from "node:child_process";
import type { TaskRecord } from "@monitor/contracts";

function shouldNotify(status: TaskRecord["status"]): boolean {
  return (
    status === "waiting_input" ||
    status === "waiting_approval" ||
    status === "finished" ||
    status === "error"
  );
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
  if (!shouldNotify(task.status)) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn("terminal-notifier", [
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
}
