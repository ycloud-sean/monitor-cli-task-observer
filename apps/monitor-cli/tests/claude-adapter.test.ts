import { describe, expect, it } from "vitest";
import {
  buildClaudeSettings,
  translateClaudeHook
} from "../src/lib/adapters/claude.js";

describe("buildClaudeSettings", () => {
  it("creates Notification and Stop hooks that invoke monitor-hook", () => {
    const settings = buildClaudeSettings({
      taskId: "task-1",
      daemonUrl: "http://127.0.0.1:45731",
      hookCommand: ["/usr/bin/node", "/tmp/monitor-hook.js"]
    });

    expect(settings.hooks.Notification[0]?.hooks[0]?.command).toContain(
      "/tmp/monitor-hook.js"
    );
    expect(settings.hooks.Stop[0]?.hooks[0]?.command).toContain(
      "/tmp/monitor-hook.js"
    );
  });
});

describe("translateClaudeHook", () => {
  it("maps Notification payloads to waiting_input or waiting_approval and Stop to finished", () => {
    expect(
      translateClaudeHook("task-1", "Notification", "{\"message\":\"needs approval\"}")
        .type
    ).toBe("task.waiting_approval");
    expect(
      translateClaudeHook("task-1", "Notification", "{\"message\":\"waiting for input\"}")
        .type
    ).toBe("task.waiting_input");
    expect(translateClaudeHook("task-1", "Stop", "").type).toBe("task.finished");
  });
});
