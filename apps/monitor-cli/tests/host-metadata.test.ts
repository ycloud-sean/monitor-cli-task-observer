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

  it("treats Cursor's vscode terminal shell as cursor", () => {
    const metadata = detectHostMetadata({
      termProgram: "vscode",
      termProgramVersion: "3.0.9",
      windowId: "Cursor A — project-a",
      ttyRef: "/dev/ttys004"
    });

    expect(metadata).toEqual({
      hostApp: "cursor",
      hostWindowRef: "Cursor A — project-a",
      hostSessionRef: null
    });
  });

  it("falls back to the active Cursor window title when no cursor ref is present", () => {
    const metadata = detectHostMetadata({
      termProgram: "vscode",
      termProgramVersion: "3.0.9",
      ttyRef: "/dev/ttys004",
      cursorWindowRef:
        'cursor-window:{"title":"Cursor A — project-a","document":"file:///tmp/project-a/README.md","workspace":"project-a","x":10,"y":38,"width":1440,"height":900}'
    });

    expect(metadata.hostApp).toBe("cursor");
    expect(metadata.hostSessionRef).toBeNull();
    expect(metadata.hostWindowRef).toBe(
      'cursor-window:{"title":"Cursor A — project-a","document":"file:///tmp/project-a/README.md","workspace":"project-a","x":10,"y":38,"width":1440,"height":900}'
    );
  });

  it("normalizes the structured Cursor workspace using cwd", () => {
    const metadata = detectHostMetadata({
      termProgram: "vscode",
      termProgramVersion: "3.0.9",
      ttyRef: "/dev/ttys004",
      cursorWindowRef:
        'cursor-window:{"title":"README.md — project-a","document":"file:///tmp/project-a/README.md","workspace":"README.md","x":10,"y":38,"width":1440,"height":900}',
      cwd: "/tmp/project-a"
    } as never);

    expect(metadata.hostApp).toBe("cursor");
    expect(metadata.hostWindowRef).toBe(
      'cursor-window:{"title":"README.md — project-a","document":"file:///tmp/project-a/README.md","workspace":"project-a","x":10,"y":38,"width":1440,"height":900}'
    );
  });
});
