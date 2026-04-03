import { describe, expect, it } from "vitest";
import { buildFocusScript } from "../src/lib/focus/router.js";

describe("buildFocusScript", () => {
  it("returns Terminal.app AppleScript for terminal tasks", () => {
    const script = buildFocusScript({
      hostApp: "terminal",
      hostWindowRef: "window-1",
      hostSessionRef: "tab-1"
    });

    expect(script).toContain('tell application "Terminal"');
  });

  it("returns iTerm2 AppleScript for iterm tasks", () => {
    const script = buildFocusScript({
      hostApp: "iterm2",
      hostWindowRef: "window-1",
      hostSessionRef: "session-1"
    });

    expect(script).toContain('tell application "iTerm2"');
  });
});
