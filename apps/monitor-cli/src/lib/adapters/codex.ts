import type { TaskEvent } from "@monitor/contracts";

export function buildCodexCommand(options: {
  taskId: string;
  daemonUrl: string;
  hookCommand: string[];
  forwardedArgs: string[];
}): string[] {
  const notifyOverride = JSON.stringify([
    ...options.hookCommand,
    "codex",
    options.taskId,
    options.daemonUrl
  ]);

  return [...options.forwardedArgs, "-c", `notify=${notifyOverride}`];
}

export function translateCodexNotify(
  taskId: string,
  payload: Record<string, unknown>
): TaskEvent | null {
  if (payload.type === "agent-turn-complete") {
    return {
      type: "task.finished",
      taskId,
      at: new Date().toISOString()
    };
  }

  return null;
}

export function detectCodexWaitState(
  line: string
): "waiting_input" | "waiting_approval" | null {
  if (/allow this command|needs approval|approval required|approve this/i.test(line)) {
    return "waiting_approval";
  }
  if (/waiting for input|press enter|enter your response|provide input/i.test(line)) {
    return "waiting_input";
  }
  return null;
}
