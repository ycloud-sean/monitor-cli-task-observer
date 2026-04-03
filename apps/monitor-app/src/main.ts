import "./styles.css";
import { fetchTasks } from "./api";
import { renderTasks } from "./render";
import { buildTaskViewModel } from "./store";

const root = document.querySelector<HTMLDivElement>("#app");
let selectedTaskId: string | undefined;

async function refresh() {
  if (!root) {
    return;
  }

  const tasks = await fetchTasks();
  const viewModel = buildTaskViewModel(tasks, selectedTaskId);
  selectedTaskId = viewModel.selectedTask?.taskId;
  document.title = `Monitor (${viewModel.summary.unreadAlertCount})`;
  renderTasks(root, viewModel);
}

root?.addEventListener("click", (event) => {
  const taskId = (event.target as HTMLElement)
    .closest<HTMLElement>(".task-row")
    ?.dataset.taskId;

  if (!taskId) {
    return;
  }

  selectedTaskId = taskId;
  void refresh();
});

void refresh();
window.setInterval(() => void refresh(), 2000);
