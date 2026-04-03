import { describe, expect, it } from "vitest";
import { detectHostMetadata } from "../src/lib/host-metadata.js";

describe("detectHostMetadata", () => {
  it("uses tty as the session ref for Terminal.app tasks", () => {
    const metadata = detectHostMetadata({
      termProgram: "Apple_Terminal",
      windowId: "42",
      ttyRef: "/dev/ttys001"
    });

    expect(metadata).toEqual({
      hostApp: "terminal",
      hostWindowRef: "42",
      hostSessionRef: "/dev/ttys001"
    });
  });

  it("uses tty as the session ref for iTerm2 tasks", () => {
    const metadata = detectHostMetadata({
      termProgram: "iTerm.app",
      termSessionId: "legacy-session",
      ttyRef: "/dev/ttys002"
    });

    expect(metadata).toEqual({
      hostApp: "iterm2",
      hostWindowRef: "legacy-session",
      hostSessionRef: "/dev/ttys002"
    });
  });

  it("keeps cursor-specific refs for cursor tasks", () => {
    const metadata = detectHostMetadata({
      termProgramVersion: "Cursor 0.52",
      cursorTraceId: "cursor-window-1",
      cursorAgent: "pane-1",
      ttyRef: "/dev/ttys003"
    });

    expect(metadata).toEqual({
      hostApp: "cursor",
      hostWindowRef: "cursor-window-1",
      hostSessionRef: "pane-1"
    });
  });
});
