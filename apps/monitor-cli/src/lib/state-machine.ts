import type { TaskEvent, TaskRecord } from "@monitor/contracts";

type TaskTransitionEvent = Exclude<TaskEvent, { type: "task.started" }>;

function assertNever(value: never): never {
  throw new Error(`Unhandled task transition event: ${JSON.stringify(value)}`);
}

export function applyEvent(
  task: TaskRecord,
  event: TaskTransitionEvent
): TaskRecord {
  if (event.at < task.lastEventAt) return task;

  const isTerminalEvent =
    event.type === "task.finished" || event.type === "task.error";
  if (event.at === task.lastEventAt && !isTerminalEvent) return task;

  const isTerminalTask = task.status === "finished" || task.status === "error";
  const isNonTerminalEvent =
    event.type === "task.output" ||
    event.type === "task.waiting_input" ||
    event.type === "task.waiting_approval";
  if (isTerminalTask && isNonTerminalEvent) return task;

  switch (event.type) {
    case "task.output":
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
