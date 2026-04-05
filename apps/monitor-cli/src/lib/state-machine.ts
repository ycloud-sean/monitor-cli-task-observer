import type { TaskEvent, TaskRecord } from "@monitor/contracts";

type TaskTransitionEvent = Exclude<TaskEvent, { type: "task.started" }>;

function stripTerminalControlSequences(text: string): string {
  return text
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, "");
}

function hasVisibleOutput(chunk: string): boolean {
  return stripTerminalControlSequences(chunk).trim().length > 0;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled task transition event: ${JSON.stringify(value)}`);
}

export function applyEvent(
  task: TaskRecord,
  event: TaskTransitionEvent
): TaskRecord {
  if (event.at < task.lastEventAt) return task;

  const isTerminalTask = task.status === "finished" || task.status === "error";
  const isNonTerminalEvent =
    event.type === "task.output" ||
    event.type === "task.waiting_input" ||
    event.type === "task.waiting_approval";
  if (isTerminalTask && isNonTerminalEvent) return task;

  switch (event.type) {
    case "task.output":
      if (
        (task.status === "waiting_input" || task.status === "waiting_approval") &&
        !hasVisibleOutput(event.payload.chunk)
      ) {
        return {
          ...task,
          lastEventAt: event.at
        };
      }

      return {
        ...task,
        status:
          task.status === "waiting_input" || task.status === "waiting_approval"
            ? "running"
            : task.status,
        lastEventAt: event.at,
        lastOutputExcerpt: event.payload.chunk.slice(-240)
      };
    case "task.waiting_input":
      return { ...task, status: "waiting_input", lastEventAt: event.at };
    case "task.waiting_approval":
      return { ...task, status: "waiting_approval", lastEventAt: event.at };
    case "task.finished":
      return { ...task, status: "finished", lastEventAt: event.at };
    case "task.error":
      return {
        ...task,
        status: "error",
        lastEventAt: event.at,
        lastOutputExcerpt: event.payload.message
      };
  }

  return assertNever(event);
}
