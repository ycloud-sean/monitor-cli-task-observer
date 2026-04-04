import { describe, expect, it } from "vitest";
import { wrapCommandWithPty } from "../src/lib/pty.js";

describe("wrapCommandWithPty", () => {
  it("wraps codex commands with the macOS script PTY shim", () => {
    expect(wrapCommandWithPty(["codex", "-c", "notify=[]"])).toEqual([
      "script",
      "-q",
      "/dev/null",
      "codex",
      "-c",
      "notify=[]"
    ]);
  });

  it("wraps claude commands with the macOS script PTY shim", () => {
    expect(wrapCommandWithPty(["claude", "--settings", "/tmp/settings.json"])).toEqual([
      "script",
      "-q",
      "/dev/null",
      "claude",
      "--settings",
      "/tmp/settings.json"
    ]);
  });
});
