import { describe, expect, it } from "vitest";
import {
  CURSOR_BRIDGE_EXTENSION_ID,
  buildCursorBridgeUri
} from "../src/lib/focus/cursor-bridge.js";

describe("buildCursorBridgeUri", () => {
  it("builds a Cursor URI with encoded query parameters", () => {
    const uri = buildCursorBridgeUri("focus", {
      taskId: "3bbe7821-f8af-4654-b784-cfba51200232",
      name: "codex 任务",
      cwd: "/tmp/project a",
      monitorPid: "4321"
    });

    expect(uri).toBe(
      `cursor://${CURSOR_BRIDGE_EXTENSION_ID}/focus?taskId=3bbe7821-f8af-4654-b784-cfba51200232&name=codex+%E4%BB%BB%E5%8A%A1&cwd=%2Ftmp%2Fproject+a&monitorPid=4321`
    );
  });
});
