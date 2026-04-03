import { describe, expect, it } from "vitest";
import {
  isWaitingState,
  type TaskEvent,
  type TaskRecord,
} from "./index.js";

describe("contracts", () => {
  it("marks waiting_input and waiting_approval as waiting states", () => {
    expect(isWaitingState("waiting_input")).toBe(true);
    expect(isWaitingState("waiting_approval")).toBe(true);
    expect(isWaitingState("running")).toBe(false);
  });

  it("allows the daemon to model task records and events", () => {
    const task: TaskRecord = {
      taskId: "task-1",
      name: "api-fix",
      runnerType: "codex",
      rawCommand: ["codex"],
      cwd: "/tmp/project",
      pid: 123,
      hostApp: "cursor",
      hostWindowRef: "cursor-window-1",
      hostSessionRef: "session-1",
      startedAt: "2026-04-03T08:00:00.000Z",
      lastEventAt: "2026-04-03T08:00:00.000Z",
      status: "running",
      lastOutputExcerpt: ""
    };

    const event: TaskEvent = {
      type: "task.finished",
      taskId: task.taskId,
      at: "2026-04-03T08:01:00.000Z"
    };

    expect(task.status).toBe("running");
    expect(event.type).toBe("task.finished");
  });

  it("models unknown host records without invented identifiers", () => {
    const unknownHostTask: TaskRecord = {
      taskId: "task-unknown-host",
      name: "background-task",
      runnerType: "claude",
      rawCommand: ["claude"],
      cwd: "/tmp/project",
      pid: 456,
      hostApp: "unknown",
      hostWindowRef: null,
      hostSessionRef: null,
      startedAt: "2026-04-03T09:00:00.000Z",
      lastEventAt: "2026-04-03T09:00:00.000Z",
      status: "running",
      lastOutputExcerpt: ""
    };

    expect(unknownHostTask.hostApp).toBe("unknown");
    expect(unknownHostTask.hostWindowRef).toBeNull();
    expect(unknownHostTask.hostSessionRef).toBeNull();
  });
});
