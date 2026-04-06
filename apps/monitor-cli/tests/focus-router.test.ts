import { describe, expect, it } from "vitest";
import { buildFocusScript } from "../src/lib/focus/router.js";

describe("buildFocusScript", () => {
  it("returns Terminal.app AppleScript for terminal tasks", () => {
    const script = buildFocusScript({
      taskId: "task-terminal",
      hostApp: "terminal",
      hostWindowRef: "42",
      hostSessionRef: "/dev/ttys001",
      cwd: "/tmp/project-terminal",
      pid: 101
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
      cwd: "/tmp/project-iterm",
      pid: 202
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
      cwd: "/tmp/project-a",
      pid: 4321
    });

    expect(script).toContain('tell application "Cursor"');
    expect(script).toContain('set targetTitle to "Cursor A — project-a"');
    expect(script).toContain('set targetDocument to "file:///tmp/project-a/README.md"');
    expect(script).toContain('set targetPosition to {10, 38}');
    expect(script).toContain('set targetSize to {1440, 900}');
    expect(script).toContain('perform action "AXRaise"');
    expect(script).toContain(
      'if targetTitle is not "" and candidateTitle is targetTitle and candidatePosition is targetPosition and candidateSize is targetSize then'
    );
    expect(script).toContain(
      'if targetWorkspace is not "" and candidateTitle ends with ("— " & targetWorkspace) and candidatePosition is targetPosition and candidateSize is targetSize then'
    );
    expect(script).toContain(
      'open location "cursor://liangxin.monitor-cursor-bridge/focus?taskId=3bbe7821-f8af-4654-b784-cfba51200232&cwd=%2Ftmp%2Fproject-a&monitorPid=4321&windowRef=cursor-window%3A%7B%22title%22%3A%22Cursor+A+%E2%80%94+project-a%22%2C%22document%22%3A%22file%3A%2F%2F%2Ftmp%2Fproject-a%2FREADME.md%22%2C%22workspace%22%3A%22project-a%22%2C%22x%22%3A10%2C%22y%22%3A38%2C%22width%22%3A1440%2C%22height%22%3A900%7D"'
    );
  });
});
