import type { TaskEvent, TaskRecord } from "@monitor/contracts";

async function assertOk(response: Response, requestName: string): Promise<void> {
  if (response.ok) return;
  const responseText = await response.text();
  const suffix = responseText ? `: ${responseText}` : "";
  throw new Error(
    `HTTP ${response.status} ${response.statusText} for ${requestName}${suffix}`
  );
}

export class DaemonClient {
  constructor(private readonly baseUrl: string) {}

  async postEvent(event: TaskEvent): Promise<void> {
    const response = await fetch(`${this.baseUrl}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event)
    });
    await assertOk(response, "POST /events");
  }

  async listTasks(): Promise<TaskRecord[]> {
    const response = await fetch(`${this.baseUrl}/tasks`);
    await assertOk(response, "GET /tasks");
    return (await response.json()) as TaskRecord[];
  }
}
