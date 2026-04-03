import type { TaskRecord } from "@monitor/contracts";

export interface TaskViewModel {
  summary: {
    activeCount: number;
    unreadAlertCount: number;
  };
  tasks: TaskRecord[];
  selectedTask: TaskRecord | null;
}

export function buildTaskViewModel(
  tasks: TaskRecord[],
  selectedTaskId?: string,
): TaskViewModel {
  const selectedTask =
    tasks.find((task) => task.taskId === selectedTaskId) ??
    tasks.find((task) => task.status.startsWith("waiting_")) ??
    tasks[0] ??
    null;

  return {
    summary: {
      activeCount: tasks.filter(
        (task) => task.status === "running" || task.status.startsWith("waiting_"),
      ).length,
      unreadAlertCount: tasks.filter((task) => task.status.startsWith("waiting_"))
        .length,
    },
    tasks,
    selectedTask,
  };
}
