import { describe, expect, it, vi } from "vitest";
import type { TaskEvent } from "@monitor/contracts";
import {
  buildCloseEvents,
  buildStreamEvents,
  createEventQueue,
  parseNameArg,
  resolveProcessExitCode
} from "../src/bin/monitor.js";
import { parseHookArgs, parseHookPayload } from "../src/bin/monitor-hook.js";

describe("parseNameArg", () => {
  it("does not treat a following flag as --name value", () => {
    const result = parseNameArg(["--name", "--model", "gpt-5-codex"]);
    expect(result).toEqual({
      name: "",
      remainingArgs: ["--model", "gpt-5-codex"]
    });
  });
});

describe("resolveProcessExitCode", () => {
  it("maps process signal exits to conventional non-zero codes", () => {
    expect(resolveProcessExitCode(null, "SIGTERM")).toBe(143);
  });
});

describe("buildStreamEvents", () => {
  it("keeps output chunk and then emits wait-state event", () => {
    const result = buildStreamEvents("task-1", "Do you want to allow this command?", "");
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      type: "task.output",
      taskId: "task-1",
      payload: { chunk: "Do you want to allow this command?" }
    });
    expect(result.events[1]).toMatchObject({
      type: "task.waiting_approval",
      taskId: "task-1"
    });
    expect(result.carryover).toBe("");
  });

  it("detects waiting prompts that arrive across chunk boundaries", () => {
    const first = buildStreamEvents("task-1", "Do you want to allow", "");
    expect(first.events).toHaveLength(1);
    expect(first.events[0]).toMatchObject({
      type: "task.output",
      taskId: "task-1",
      payload: { chunk: "Do you want to allow" }
    });

    const second = buildStreamEvents("task-1", " this command?", first.carryover);
    expect(second.events).toHaveLength(2);
    expect(second.events[0]).toMatchObject({
      type: "task.output",
      taskId: "task-1",
      payload: { chunk: " this command?" }
    });
    expect(second.events[1]).toMatchObject({
      type: "task.waiting_approval",
      taskId: "task-1"
    });
  });

  it("does not infer codex wait states for claude output", () => {
    const result = buildStreamEvents(
      "task-1",
      "waiting for input",
      "",
      "claude"
    );

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: "task.output",
      taskId: "task-1",
      payload: { chunk: "waiting for input" }
    });
  });
});

describe("resolveCloseEvents", () => {
  it("emits task.finished when codex exits cleanly", () => {
    const result = buildCloseEvents("task-1", 0, null);

    expect(result.exitCode).toBe(0);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: "task.finished",
      taskId: "task-1"
    });
  });

  it("includes the runner name in non-zero exit errors", () => {
    const result = buildCloseEvents("task-1", 1, null, "claude");

    expect(result.events[0]).toMatchObject({
      type: "task.error",
      payload: { message: "claude exited with code 1" }
    });
  });
});

describe("createEventQueue", () => {
  it("continues processing events after a post failure", async () => {
    let attempt = 0;
    const posted: string[] = [];
    const onError = vi.fn();
    const queue = createEventQueue(
      async (event: TaskEvent) => {
        attempt += 1;
        if (attempt === 1) {
          throw new Error("boom");
        }
        posted.push(event.type);
      },
      onError
    );

    queue.enqueue({ type: "task.output", taskId: "task-1", at: "1", payload: { chunk: "a" } });
    queue.enqueue({ type: "task.output", taskId: "task-1", at: "2", payload: { chunk: "b" } });
    await queue.drain();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(posted).toEqual(["task.output"]);
  });
});

describe("monitor-hook argument/payload parsing", () => {
  it("parses claude hook names from positional arguments", () => {
    const args = parseHookArgs([
      "node",
      "monitor-hook.js",
      "claude",
      "task-1",
      "http://127.0.0.1:45731",
      "Notification"
    ]);
    expect(args).toEqual({
      runner: "claude",
      taskId: "task-1",
      daemonUrl: "http://127.0.0.1:45731",
      payloadText: "Notification"
    });
  });

  it("falls back to the last argv entry for payload text", () => {
    const args = parseHookArgs([
      "node",
      "monitor-hook.js",
      "codex",
      "task-1",
      "http://127.0.0.1:45731",
      "--extra",
      "{\"type\":\"agent-turn-complete\"}"
    ]);
    expect(args).toEqual({
      runner: "codex",
      taskId: "task-1",
      daemonUrl: "http://127.0.0.1:45731",
      payloadText: "{\"type\":\"agent-turn-complete\"}"
    });
  });

  it("tolerates non-JSON payloads", () => {
    expect(parseHookPayload("not-json")).toEqual({ raw: "not-json" });
  });
});
