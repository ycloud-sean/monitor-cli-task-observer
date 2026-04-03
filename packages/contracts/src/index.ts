export type RunnerType = "codex" | "claude";
export type TaskStatus =
  | "running"
  | "waiting_input"
  | "waiting_approval"
  | "finished"
  | "error";

export type HostApp = "terminal" | "iterm2" | "cursor" | "unknown";

export interface TaskRecord {
  taskId: string;
  name: string;
  runnerType: RunnerType;
  rawCommand: string[];
  cwd: string;
  pid: number;
  hostApp: HostApp;
  hostWindowRef: string;
  hostSessionRef: string;
  startedAt: string;
  lastEventAt: string;
  status: TaskStatus;
  lastOutputExcerpt: string;
}

interface TaskEventBase {
  taskId: string;
  at: string;
}

export type TaskEvent =
  | ({ type: "task.started"; payload: TaskRecord } & TaskEventBase)
  | ({ type: "task.output"; payload: { chunk: string } } & TaskEventBase)
  | ({ type: "task.waiting_input" } & TaskEventBase)
  | ({ type: "task.waiting_approval" } & TaskEventBase)
  | ({ type: "task.finished" } & TaskEventBase)
  | ({ type: "task.error"; payload: { message: string } } & TaskEventBase);

export function isWaitingState(status: TaskStatus): boolean {
  return status === "waiting_input" || status === "waiting_approval";
}
