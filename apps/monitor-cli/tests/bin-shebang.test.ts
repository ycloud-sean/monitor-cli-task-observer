import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSourceEntry(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("bin entrypoints", () => {
  it("declare a node shebang so npm bin shims execute them correctly", () => {
    expect(readSourceEntry("../src/bin/monitor.ts")).toMatch(/^#!\/usr\/bin\/env node/m);
    expect(readSourceEntry("../src/bin/monitord.ts")).toMatch(/^#!\/usr\/bin\/env node/m);
    expect(readSourceEntry("../src/bin/monitor-hook.ts")).toMatch(
      /^#!\/usr\/bin\/env node/m
    );
  });
});
