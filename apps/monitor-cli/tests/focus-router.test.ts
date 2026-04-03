import { describe, expect, it } from "vitest";
import { buildFocusScript } from "../src/lib/focus/router.js";

describe("buildFocusScript", () => {
  it("returns Terminal.app AppleScript for terminal tasks", () => {
    const script = buildFocusScript({
      hostApp: "terminal",
      hostWindowRef: "42",
      hostSessionRef: "/dev/ttys001"
    });

    expect(script).toContain('tell application "Terminal"');
    expect(script).toContain('/dev/ttys001');
    expect(script).toContain("42");
  });

  it("returns iTerm2 AppleScript for iterm tasks", () => {
    const script = buildFocusScript({
      hostApp: "iterm2",
      hostWindowRef: null,
      hostSessionRef: "/dev/ttys002"
    });

    expect(script).toContain('tell application "iTerm2"');
    expect(script).toContain('/dev/ttys002');
    expect(script).toContain("select");
  });

  it("returns a Cursor activation script for cursor tasks", () => {
    const script = buildFocusScript({
      hostApp: "cursor",
      hostWindowRef: "cursor-window-1",
      hostSessionRef: "pane-1"
    });

    expect(script).toContain('tell application "Cursor"');
  });
});
