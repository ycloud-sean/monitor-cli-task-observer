import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles.css";
import { fetchTasks, focusTask } from "./api";
import { parseTaskUrl } from "./deep-link";
import { renderError, renderTasks } from "./render";
import { buildTaskViewModel } from "./store";

const root = document.querySelector<HTMLDivElement>("#app");
let selectedTaskId: string | undefined;

async function refresh() {
  if (!root) {
    return;
  }

  try {
    const tasks = await fetchTasks();
    const viewModel = buildTaskViewModel(tasks, selectedTaskId);
    selectedTaskId = viewModel.selectedTask?.taskId;
    document.title = `Monitor (${viewModel.summary.unreadAlertCount})`;
    renderTasks(root, viewModel);
  } catch (error) {
    document.title = "Monitor (!)";
    renderError(root, String(error));
  }
}

async function handleUrls(urls: string[]) {
  const first = urls
    .map(parseTaskUrl)
    .find((value): value is { taskId: string } => value !== null);
  if (!first) {
    return;
  }

  selectedTaskId = first.taskId;
  await refresh();
  await Promise.allSettled([
    getCurrentWindow().show(),
    getCurrentWindow().unminimize(),
    getCurrentWindow().setFocus()
  ]);
}

root?.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const focusTaskId = target.closest<HTMLElement>(".focus-task")?.dataset.taskId;
  if (focusTaskId) {
    selectedTaskId = focusTaskId;
    void (async () => {
      await focusTask(focusTaskId).catch(() => false);
      await refresh();
    })();
    return;
  }

  const taskId = target
    .closest<HTMLElement>(".task-row")
    ?.dataset.taskId;

  if (!taskId) {
    return;
  }

  selectedTaskId = taskId;
  void refresh();
});

void getCurrent().then((urls) => {
  if (urls && urls.length > 0) {
    void handleUrls(urls);
  }
});

void onOpenUrl((urls) => {
  void handleUrls(urls);
});

void refresh();
window.setInterval(() => void refresh(), 2000);
