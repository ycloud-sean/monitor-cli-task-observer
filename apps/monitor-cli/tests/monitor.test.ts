import { describe, expect, it, vi } from "vitest";
import type { TaskEvent } from "@monitor/contracts";
import {
  buildStdoutEvents,
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

describe("buildStdoutEvents", () => {
  it("keeps output chunk and then emits wait-state event", () => {
    const events = buildStdoutEvents("task-1", "Do you want to allow this command?");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "task.output",
      taskId: "task-1",
      payload: { chunk: "Do you want to allow this command?" }
    });
    expect(events[1]).toMatchObject({
      type: "task.waiting_approval",
      taskId: "task-1"
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
