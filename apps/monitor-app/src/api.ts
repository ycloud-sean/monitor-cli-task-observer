import type { TaskRecord } from "@monitor/contracts";

const DEFAULT_BASE_URL = "http://127.0.0.1:45731";

export function resolveDaemonBaseUrl(envValue = import.meta.env.VITE_MONITOR_DAEMON_URL): string {
  return envValue && envValue.trim() ? envValue : DEFAULT_BASE_URL;
}

export async function fetchTasks(baseUrl = resolveDaemonBaseUrl()): Promise<TaskRecord[]> {
  const response = await fetch(`${baseUrl}/tasks`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as TaskRecord[];
}
