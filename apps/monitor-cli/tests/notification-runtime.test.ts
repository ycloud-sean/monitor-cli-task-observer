import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskRecord } from "@monitor/contracts";

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
    status: "finished",
    lastOutputExcerpt: "",
    ...overrides
  };
}

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unmock("node:child_process");
});

describe("notifyTask", () => {
  it("returns once the notifier process has spawned", async () => {
    const spawn = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = vi.fn();
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });

    vi.doMock("node:child_process", () => ({ spawn }));

    const { notifyTask } = await import("../src/lib/notification.js");
    const outcome = await Promise.race([
      notifyTask(makeTask()).then(() => "resolved"),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 50))
    ]);

    expect(outcome).toBe("resolved");
    expect(spawn).toHaveBeenCalledWith(
      expect.stringContaining(
        "terminal-notifier.app/Contents/MacOS/terminal-notifier"
      ),
      expect.arrayContaining([
        "-title",
        "Monitor",
        "-message",
        "api-fix finished",
        "-group",
        "task-1",
        "-open",
        "monitor://task/task-1"
      ]),
      expect.objectContaining({
        detached: true,
        stdio: "ignore"
      })
    );
  });

  it("rejects if the notifier process fails before spawning", async () => {
    const spawn = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = vi.fn();
      queueMicrotask(() => child.emit("error", new Error("boom")));
      return child;
    });

    vi.doMock("node:child_process", () => ({ spawn }));

    const { notifyTask } = await import("../src/lib/notification.js");

    await expect(notifyTask(makeTask())).rejects.toThrow("boom");
  });

  it("uses osascript dialogs for waiting_input tasks", async () => {
    const spawn = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = vi.fn();
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });

    vi.doMock("node:child_process", () => ({ spawn }));

    const { notifyTask } = await import("../src/lib/notification.js");
    await notifyTask(
      makeTask({
        status: "waiting_input",
        name: "needs-reply",
        hostApp: "cursor",
        hostWindowRef: null,
        hostSessionRef: null
      })
    );

    expect(spawn).toHaveBeenCalledWith(
      "osascript",
      expect.arrayContaining([
        "-e",
        expect.stringContaining("任务“needs-reply”正在等待你输入。"),
        expect.stringContaining("Monitor 等待输入"),
        expect.stringContaining('buttons {"忽略", "打开任务"}'),
        expect.stringContaining('if button returned of dialogResult is "打开任务" then'),
        expect.stringContaining('tell application "Cursor"')
      ]),
      expect.objectContaining({
        detached: true,
        stdio: "ignore"
      })
    );
  });
});
