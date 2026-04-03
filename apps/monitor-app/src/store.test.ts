import { describe, expect, it } from "vitest";
import type { TaskRecord } from "@monitor/contracts";
import { buildTaskViewModel } from "./store";

const tasks: TaskRecord[] = [
  {
    taskId: "1",
    name: "api-fix",
    runnerType: "codex",
    rawCommand: ["codex"],
    cwd: "/tmp/project",
    pid: 1,
    hostApp: "cursor",
    hostWindowRef: "window-1",
    hostSessionRef: "pane-1",
    startedAt: "2026-04-03T08:00:00.000Z",
    lastEventAt: "2026-04-03T08:02:00.000Z",
    status: "waiting_approval",
    lastOutputExcerpt: "Do you want to allow this command?",
  },
  {
    taskId: "2",
    name: "auth-debug",
    runnerType: "claude",
    rawCommand: ["claude"],
    cwd: "/tmp/project",
    pid: 2,
    hostApp: "terminal",
    hostWindowRef: "window-2",
    hostSessionRef: "tab-2",
    startedAt: "2026-04-03T08:01:00.000Z",
    lastEventAt: "2026-04-03T08:03:00.000Z",
    status: "running",
    lastOutputExcerpt: "",
  },
];

describe("buildTaskViewModel", () => {
  it("counts active and unread alert tasks", () => {
    expect(buildTaskViewModel(tasks).summary).toEqual({
      activeCount: 2,
      unreadAlertCount: 1,
    });
  });

  it("keeps a selected task ready for the detail panel", () => {
    expect(buildTaskViewModel(tasks, "1").selectedTask).toMatchObject({
      taskId: "1",
      name: "api-fix",
      cwd: "/tmp/project",
      status: "waiting_approval",
      lastOutputExcerpt: "Do you want to allow this command?",
    });
  });
});
