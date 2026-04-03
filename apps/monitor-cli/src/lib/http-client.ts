import type { TaskEvent, TaskRecord } from "@monitor/contracts";

export class DaemonClient {
  constructor(private readonly baseUrl: string) {}

  async postEvent(event: TaskEvent): Promise<void> {
    await fetch(`${this.baseUrl}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event)
    });
  }

  async listTasks(): Promise<TaskRecord[]> {
    const response = await fetch(`${this.baseUrl}/tasks`);
    return (await response.json()) as TaskRecord[];
  }
}
