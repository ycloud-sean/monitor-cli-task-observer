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
});
