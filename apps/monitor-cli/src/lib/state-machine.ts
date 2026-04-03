import type { TaskEvent, TaskRecord } from "@monitor/contracts";

export function applyEvent(task: TaskRecord, event: TaskEvent): TaskRecord {
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
    default:
      return task;
  }
}
