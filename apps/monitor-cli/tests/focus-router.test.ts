import { describe, expect, it } from "vitest";
import { buildFocusScript } from "../src/lib/focus/router.js";

describe("buildFocusScript", () => {
  it("returns Terminal.app AppleScript for terminal tasks", () => {
    const script = buildFocusScript({
      taskId: "task-terminal",
      hostApp: "terminal",
      hostWindowRef: "42",
      hostSessionRef: "/dev/ttys001",
      cwd: "/tmp/project-terminal"
    });

    expect(script).toContain('tell application "Terminal"');
    expect(script).toContain('/dev/ttys001');
    expect(script).toContain("42");
  });

  it("returns iTerm2 AppleScript for iterm tasks", () => {
    const script = buildFocusScript({
      taskId: "task-iterm",
      hostApp: "iterm2",
      hostWindowRef: null,
      hostSessionRef: "/dev/ttys002",
      cwd: "/tmp/project-iterm"
    });

    expect(script).toContain('tell application "iTerm2"');
    expect(script).toContain('/dev/ttys002');
    expect(script).toContain("select");
  });

  it("returns a Cursor activation script for cursor tasks", () => {
    const script = buildFocusScript({
      taskId: "3bbe7821-f8af-4654-b784-cfba51200232",
      hostApp: "cursor",
      hostWindowRef:
        'cursor-window:{"title":"Cursor A — project-a","document":"file:///tmp/project-a/README.md","workspace":"project-a","x":10,"y":38,"width":1440,"height":900}',
      hostSessionRef: "pane-1",
      cwd: "/tmp/project-a"
    });

    expect(script).toContain('set targetCwd to "/tmp/project-a"');
    expect(script).toContain('do shell script "/usr/bin/open -a Cursor " & quoted form of targetCwd');
    expect(script).toContain('tell application "Cursor"');
    expect(script).toContain('set targetTitle to "Cursor A — project-a"');
    expect(script).toContain('set targetDocument to "file:///tmp/project-a/README.md"');
    expect(script).toContain('set targetPosition to {10, 38}');
    expect(script).toContain('set targetSize to {1440, 900}');
    expect(script).toContain('perform action "AXRaise"');
    expect(script).toContain(
      'open location "cursor://liangxin.monitor-cursor-bridge/focus?taskId=3bbe7821-f8af-4654-b784-cfba51200232"'
    );
  });
});
