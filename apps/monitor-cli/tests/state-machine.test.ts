import { describe, expect, it } from "vitest";
import type { TaskRecord } from "@monitor/contracts";
import { applyEvent } from "../src/lib/state-machine.js";
import { TaskRegistry } from "../src/lib/registry.js";

function makeTask(): TaskRecord {
  return {
    taskId: "task-1",
    name: "api-fix",
    runnerType: "codex",
    rawCommand: ["codex"],
    cwd: "/tmp/project",
    pid: 321,
    hostApp: "terminal",
    hostWindowRef: "window-1",
    hostSessionRef: "tab-1",
    startedAt: "2026-04-03T08:00:00.000Z",
    lastEventAt: "2026-04-03T08:00:00.000Z",
    status: "running",
    lastOutputExcerpt: ""
  };
}

describe("applyEvent", () => {
  it("moves a running task into waiting_approval", () => {
    const next = applyEvent(makeTask(), {
      type: "task.waiting_approval",
      taskId: "task-1",
      at: "2026-04-03T08:01:00.000Z"
    });

    expect(next.status).toBe("waiting_approval");
  });

  it("returns to running after output arrives", () => {
    const waiting = { ...makeTask(), status: "waiting_input" as const };
    const next = applyEvent(waiting, {
      type: "task.output",
      taskId: "task-1",
      at: "2026-04-03T08:01:00.000Z",
      payload: { chunk: "continuing work" }
    });

    expect(next.status).toBe("running");
    expect(next.lastOutputExcerpt).toContain("continuing work");
  });

  it("does not move a finished task back to waiting_approval", () => {
    const finished = { ...makeTask(), status: "finished" as const };
    const next = applyEvent(finished, {
      type: "task.waiting_approval",
      taskId: "task-1",
      at: "2026-04-03T08:02:00.000Z"
    });

    expect(next.status).toBe("finished");
  });

  it("ignores stale out-of-order events", () => {
    const current = {
      ...makeTask(),
      status: "waiting_input" as const,
      lastEventAt: "2026-04-03T08:03:00.000Z"
    };
    const next = applyEvent(current, {
      type: "task.output",
      taskId: "task-1",
      at: "2026-04-03T08:02:00.000Z",
      payload: { chunk: "older output" }
    });

    expect(next.status).toBe("waiting_input");
    expect(next.lastEventAt).toBe("2026-04-03T08:03:00.000Z");
  });

  it("ignores equal-timestamp non-start events", () => {
    const current = {
      ...makeTask(),
      status: "waiting_input" as const,
      lastEventAt: "2026-04-03T08:03:00.000Z"
    };
    const next = applyEvent(current, {
      type: "task.output",
      taskId: "task-1",
      at: "2026-04-03T08:03:00.000Z",
      payload: { chunk: "same-time output" }
    });

    expect(next.status).toBe("waiting_input");
    expect(next.lastEventAt).toBe("2026-04-03T08:03:00.000Z");
  });
});

describe("TaskRegistry", () => {
  it("stores and updates tasks by id", () => {
    const registry = new TaskRegistry();
    const task = makeTask();

    registry.upsert(task);
    registry.apply({
      type: "task.finished",
      taskId: task.taskId,
      at: "2026-04-03T08:02:00.000Z"
    });

    expect(registry.get(task.taskId)?.status).toBe("finished");
    expect(registry.listActive()).toHaveLength(0);
  });

  it("keeps terminal status in registry when waiting event arrives later", () => {
    const registry = new TaskRegistry();
    const task = makeTask();
    registry.upsert(task);

    registry.apply({
      type: "task.finished",
      taskId: task.taskId,
      at: "2026-04-03T08:02:00.000Z"
    });
    registry.apply({
      type: "task.waiting_approval",
      taskId: task.taskId,
      at: "2026-04-03T08:03:00.000Z"
    });

    expect(registry.get(task.taskId)?.status).toBe("finished");
    expect(registry.listActive()).toHaveLength(0);
  });

  it("ignores stale events in registry without changing status or timestamp", () => {
    const registry = new TaskRegistry();
    const task = makeTask();
    registry.upsert(task);

    registry.apply({
      type: "task.waiting_input",
      taskId: task.taskId,
      at: "2026-04-03T08:03:00.000Z"
    });
    registry.apply({
      type: "task.output",
      taskId: task.taskId,
      at: "2026-04-03T08:02:00.000Z",
      payload: { chunk: "older output" }
    });

    expect(registry.get(task.taskId)?.status).toBe("waiting_input");
    expect(registry.get(task.taskId)?.lastEventAt).toBe(
      "2026-04-03T08:03:00.000Z"
    );
  });

  it("ignores stale task.started events when a newer record already exists", () => {
    const registry = new TaskRegistry();
    const newerTask = {
      ...makeTask(),
      startedAt: "2026-04-03T08:03:00.000Z",
      lastEventAt: "2026-04-03T08:03:00.000Z",
      status: "waiting_input" as const
    };
    registry.upsert(newerTask);

    registry.apply({
      type: "task.started",
      taskId: newerTask.taskId,
      at: "2026-04-03T08:01:00.000Z",
      payload: {
        ...newerTask,
        startedAt: "2026-04-03T08:01:00.000Z",
        lastEventAt: "2026-04-03T08:01:00.000Z",
        status: "running"
      }
    });

    expect(registry.get(newerTask.taskId)).toEqual(newerTask);
  });

  it("returns undefined for unknown-task events", () => {
    const registry = new TaskRegistry();

    const result = registry.apply({
      type: "task.output",
      taskId: "missing-task",
      at: "2026-04-03T08:01:00.000Z",
      payload: { chunk: "hello" }
    });

    expect(result).toBeUndefined();
  });
});
