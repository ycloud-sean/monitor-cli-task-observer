import { describe, expect, it } from "vitest";
import {
  buildCodexCommand,
  detectCodexWaitState,
  translateCodexNotify
} from "../src/lib/adapters/codex.js";

describe("buildCodexCommand", () => {
  it("injects a notify override that points to monitor-hook", () => {
    const args = buildCodexCommand({
      taskId: "task-1",
      daemonUrl: "http://127.0.0.1:45731",
      hookCommand: ["/usr/bin/node", "/tmp/monitor-hook.js"],
      forwardedArgs: ["codex", "--model", "gpt-5-codex"]
    });

    expect(args).toContain("-c");
    expect(args.join(" ")).toContain("notify");
    expect(args.join(" ")).toContain("/tmp/monitor-hook.js");
  });
});

describe("translateCodexNotify", () => {
  it("maps agent-turn-complete into task.finished", () => {
    const event = translateCodexNotify("task-1", {
      type: "agent-turn-complete",
      "turn-id": "123",
      "input-messages": ["rename foo to bar"],
      "last-assistant-message": "done"
    });

    expect(event).not.toBeNull();
    if (!event) throw new Error("expected event");
    expect(event.type).toBe("task.finished");
  });

  it("returns null for unknown payloads to avoid duplicate output", () => {
    const event = translateCodexNotify("task-1", {
      type: "unknown-event",
      foo: "bar"
    });

    expect(event).toBeNull();
  });
});

describe("detectCodexWaitState", () => {
  it("detects approval prompts from stdout", () => {
    expect(detectCodexWaitState("Do you want to allow this command?")).toBe(
      "waiting_approval"
    );
    expect(detectCodexWaitState("")).toBeNull();
  });
});
