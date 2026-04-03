import type { TaskEvent, TaskRecord } from "@monitor/contracts";
import { applyEvent } from "./state-machine.js";

export class TaskRegistry {
  #tasks = new Map<string, TaskRecord>();

  upsert(task: TaskRecord): void {
    this.#tasks.set(task.taskId, task);
  }

  apply(event: TaskEvent): TaskRecord | undefined {
    if (event.type === "task.started") {
      this.upsert(event.payload);
      return event.payload;
    }

    const current = this.#tasks.get(event.taskId);
    if (!current) return undefined;

    const next = applyEvent(current, event);
    this.#tasks.set(event.taskId, next);
    return next;
  }

  get(taskId: string): TaskRecord | undefined {
    return this.#tasks.get(taskId);
  }

  list(): TaskRecord[] {
    return [...this.#tasks.values()].sort((a, b) =>
      b.lastEventAt.localeCompare(a.lastEventAt)
    );
  }

  listActive(): TaskRecord[] {
    return this.list().filter(
      (task) => task.status === "running" || task.status.startsWith("waiting_")
    );
  }
}
