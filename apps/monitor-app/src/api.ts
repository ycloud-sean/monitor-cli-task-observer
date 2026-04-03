import type { TaskRecord } from "@monitor/contracts";

const BASE_URL = "http://127.0.0.1:45731";

export async function fetchTasks(): Promise<TaskRecord[]> {
  const response = await fetch(`${BASE_URL}/tasks`);
  return (await response.json()) as TaskRecord[];
}
