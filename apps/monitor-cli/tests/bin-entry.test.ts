import { describe, expect, it } from "vitest";
import { isDirectExecution } from "../src/lib/bin-entry.js";

describe("isDirectExecution", () => {
  it("treats npm bin symlink paths as direct execution", () => {
    expect(
      isDirectExecution(
        "/Users/liangxin/Desktop/studddd/apps/monitor-cli/dist/bin/monitor.js",
        "/Users/liangxin/Desktop/studddd/node_modules/.bin/monitor",
        (path) => {
          if (path === "/Users/liangxin/Desktop/studddd/node_modules/.bin/monitor") {
            return "/Users/liangxin/Desktop/studddd/apps/monitor-cli/dist/bin/monitor.js";
          }
          return path;
        }
      )
    ).toBe(true);
  });

  it("returns false when argv[1] points at a different executable", () => {
    expect(
      isDirectExecution(
        "/Users/liangxin/Desktop/studddd/apps/monitor-cli/dist/bin/monitor.js",
        "/Users/liangxin/Desktop/studddd/apps/monitor-cli/dist/bin/monitord.js"
      )
    ).toBe(false);
  });
});
