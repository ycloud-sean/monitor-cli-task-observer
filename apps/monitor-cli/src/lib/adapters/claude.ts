import type { TaskEvent } from "@monitor/contracts";

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildClaudeSettings(options: {
  taskId: string;
  daemonUrl: string;
  hookCommand: string[];
}) {
  const baseCommand = [...options.hookCommand, "claude", options.taskId, options.daemonUrl]
    .map(shellQuote)
    .join(" ");

  return {
    hooks: {
      Notification: [
        {
          hooks: [
            {
              type: "command",
              command: `${baseCommand} Notification`
            }
          ]
        }
      ],
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command: `${baseCommand} Stop`
            }
          ]
        }
      ],
      SessionEnd: [
        {
          hooks: [
            {
              type: "command",
              command: `${baseCommand} SessionEnd`
            }
          ]
        }
      ]
    }
  };
}

export function translateClaudeHook(
  taskId: string,
  hookName: "Notification" | "Stop" | "SessionEnd",
  hookPayload = ""
): TaskEvent {
  if (hookName === "SessionEnd") {
    return {
      type: "task.finished",
      taskId,
      at: new Date().toISOString()
    };
  }

  if (hookName === "Stop") {
    return {
      type: "task.waiting_input",
      taskId,
      at: new Date().toISOString()
    };
  }

  const waitingType = /approve|approval|allow|permission/i.test(hookPayload)
    ? "task.waiting_approval"
    : "task.waiting_input";

  return {
    type: waitingType,
    taskId,
    at: new Date().toISOString()
  };
}
