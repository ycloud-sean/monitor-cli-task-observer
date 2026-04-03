import type { TaskRecord } from "@monitor/contracts";
import type { TaskViewModel } from "./store";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderTaskRow(task: TaskRecord, selectedTaskId?: string): string {
  const selectedClass = task.taskId === selectedTaskId ? " selected" : "";

  return `
    <button class="task-row${selectedClass}" data-task-id="${escapeHtml(task.taskId)}">
      <strong>${escapeHtml(task.name)}</strong>
      <span>${escapeHtml(task.runnerType)}</span>
      <span>${escapeHtml(task.status)}</span>
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
                <h2>${escapeHtml(detail.name)}</h2>
                <p>${escapeHtml(detail.runnerType)} · ${escapeHtml(detail.status)}</p>
              </div>
              <button class="focus-task" data-task-id="${escapeHtml(detail.taskId)}">Focus task</button>
            </header>
            <dl>
              <dt>Command</dt>
              <dd>${escapeHtml(detail.rawCommand.join(" "))}</dd>
              <dt>Working directory</dt>
              <dd>${escapeHtml(detail.cwd)}</dd>
              <dt>Recent output</dt>
              <dd>${escapeHtml(detail.lastOutputExcerpt || "No output captured yet.")}</dd>
            </dl>
          `
          : `<p class="muted">Select a task to inspect it.</p>`
      }
    </section>
  `;
}

export function renderError(root: HTMLElement, message: string) {
  root.innerHTML = `
    <section class="task-detail">
      <p class="muted">Unable to reach daemon: ${escapeHtml(message)}</p>
    </section>
  `;
}
