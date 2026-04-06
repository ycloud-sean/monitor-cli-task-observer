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
        'cursor-window:{"title":"Cursor A — project-a","document":"file:///tmp/project-a/README.md","workspace":"project-a","x":10,"y":38,"width":1440,"height":900,"windowNumber":71,"identifier":"window-71"}',
      hostSessionRef: "pane-1",
      cwd: "/tmp/project-a",
      pid: 4321
    });

    expect(script).toContain('tell application "Cursor"');
    expect(script).toContain('set targetTitle to "Cursor A — project-a"');
    expect(script).toContain('set targetDocument to "file:///tmp/project-a/README.md"');
    expect(script).toContain('set targetWorkspace to "project-a"');
    expect(script).toContain('set targetPosition to {10, 38}');
    expect(script).toContain('set targetSize to {1440, 900}');
    expect(script).toContain("set targetWindowNumber to 71");
    expect(script).toContain('set targetIdentifier to "window-71"');
    expect(script).toContain('set candidateName to ""');
    expect(script).toContain('if targetWorkspace is not "" and candidateName is targetWorkspace then');
    expect(script).toContain('perform action "AXRaise"');
    expect(script).toContain(
      'if targetWindowNumber is not -1 and candidateWindowNumber is targetWindowNumber then'
    );
    expect(script).toContain(
      'if targetWorkspace is not "" and candidateTitle ends with ("— " & targetWorkspace) then'
    );
    expect(script).toContain('if matchedWindow is not missing value and bestScore >= 200 then');
    expect(script).toContain(
      'open location "cursor://liangxin.monitor-cursor-bridge/focus?taskId=3bbe7821-f8af-4654-b784-cfba51200232'
    );
    expect(script).toContain("windowNumber%22%3A71");
    expect(script).toContain("identifier%22%3A%22window-71%22");
  });
});
