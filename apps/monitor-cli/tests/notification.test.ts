import { describe, expect, it } from "vitest";
import type { TaskRecord } from "@monitor/contracts";
import {
  isNotificationSupported,
  shouldNotifyTaskUpdate
} from "../src/lib/notification.js";

function makeTask(
  overrides: Partial<TaskRecord> = {}
): TaskRecord {
  return {
    taskId: "task-1",
    name: "api-fix",
    runnerType: "codex",
    rawCommand: ["codex"],
    cwd: "/tmp/project",
    pid: 123,
    hostApp: "terminal",
    hostWindowRef: "window-1",
    hostSessionRef: "tab-1",
    startedAt: "2026-04-03T08:00:00.000Z",
    lastEventAt: "2026-04-03T08:00:00.000Z",
    status: "running",
    lastOutputExcerpt: "",
    ...overrides
  };
}

describe("isNotificationSupported", () => {
  it("only enables notifications on macOS", () => {
    expect(isNotificationSupported("darwin")).toBe(true);
    expect(isNotificationSupported("linux")).toBe(false);
  });
});

describe("shouldNotifyTaskUpdate", () => {
  it("does not notify again for unchanged waiting state", () => {
    const previous = makeTask({
      status: "waiting_approval",
      lastEventAt: "2026-04-03T08:01:00.000Z"
    });
    const next = makeTask({
      status: "waiting_approval",
      lastEventAt: "2026-04-03T08:01:00.000Z"
    });

    expect(shouldNotifyTaskUpdate(previous, next, "darwin")).toBe(false);
  });

  it("notifies on macOS when a task transitions into a notifiable state", () => {
    const previous = makeTask({
      status: "running",
      lastEventAt: "2026-04-03T08:00:00.000Z"
    });
    const next = makeTask({
      status: "waiting_input",
      lastEventAt: "2026-04-03T08:01:00.000Z"
    });

    expect(shouldNotifyTaskUpdate(previous, next, "darwin")).toBe(true);
  });
});
