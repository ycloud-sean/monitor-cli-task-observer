import type { TaskRecord } from "@monitor/contracts";
import type { TaskViewModel } from "./store";

function renderTaskRow(task: TaskRecord, selectedTaskId?: string): string {
  const selectedClass = task.taskId === selectedTaskId ? " selected" : "";

  return `
    <button class="task-row${selectedClass}" data-task-id="${task.taskId}">
      <strong>${task.name}</strong>
      <span>${task.runnerType}</span>
      <span>${task.status}</span>
      <span class="task-meta">${new Date(task.lastEventAt).toLocaleTimeString()}</span>
    </button>
  `;
}

export function renderTasks(root: HTMLElement, viewModel: TaskViewModel) {
  const detail = viewModel.selectedTask;

  root.innerHTML = `
    <section class="summary">
      <span class="summary-pill">Active ${viewModel.summary.activeCount}</span>
      <span class="summary-pill alert">Alerts ${viewModel.summary.unreadAlertCount}</span>
    </section>
    <section class="task-list">
      ${viewModel.tasks.map((task) => renderTaskRow(task, detail?.taskId)).join("")}
    </section>
    <section class="task-detail">
      ${
        detail
          ? `
            <header class="task-detail-header">
              <div>
                <h2>${detail.name}</h2>
                <p>${detail.runnerType} · ${detail.status}</p>
              </div>
              <button class="focus-task" data-task-id="${detail.taskId}">Focus task</button>
            </header>
            <dl>
              <dt>Command</dt>
              <dd>${detail.rawCommand.join(" ")}</dd>
              <dt>Working directory</dt>
              <dd>${detail.cwd}</dd>
              <dt>Recent output</dt>
              <dd>${detail.lastOutputExcerpt || "No output captured yet."}</dd>
            </dl>
          `
          : `<p class="muted">Select a task to inspect it.</p>`
      }
    </section>
  `;
}
