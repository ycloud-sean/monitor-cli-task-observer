import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureCursorBridgeInstalled,
  isCursorBridgeInstalled,
  resolveCursorBridgeSourceDir,
  resolveCursorExtensionsDir,
  resolveCursorBridgeTargetDir
} from "../src/lib/install/cursor-bridge.js";

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createCursorBridgeDir(baseDir: string): string {
  mkdirSync(baseDir, { recursive: true });
  writeFileSync(join(baseDir, "package.json"), "{}\n");
  writeFileSync(join(baseDir, "extension.js"), "module.exports = {};\n");
  return baseDir;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("resolveCursorExtensionsDir", () => {
  it("prefers the environment override", () => {
    expect(
      resolveCursorExtensionsDir({
        MONITOR_CURSOR_EXTENSIONS_DIR: "/tmp/cursor-ext"
      })
    ).toBe("/tmp/cursor-ext");
  });
});

describe("resolveCursorBridgeSourceDir", () => {
  it("prefers the explicit environment source directory", () => {
    const sourceDir = createCursorBridgeDir(join(createTempDir("monitor-bridge-"), "bridge"));

    expect(
      resolveCursorBridgeSourceDir("file:///tmp/ignored.js", {
        MONITOR_CURSOR_BRIDGE_SOURCE_DIR: sourceDir
      })
    ).toBe(sourceDir);
  });

  it("finds the sibling app directory from a built dist path", () => {
    const libexecRoot = createTempDir("monitor-libexec-");
    const sourceDir = createCursorBridgeDir(
      join(libexecRoot, "apps", "monitor-cursor-extension")
    );
    const moduleUrl = new URL(
      `file://${join(libexecRoot, "apps", "monitor-cli", "dist", "lib", "install", "cursor-bridge.js")}`
    ).toString();

    expect(resolveCursorBridgeSourceDir(moduleUrl, {})).toBe(sourceDir);
  });
});

describe("ensureCursorBridgeInstalled", () => {
  it("skips installation when the target already contains the extension", () => {
    const extensionsDir = createTempDir("monitor-cursor-ext-");
    createCursorBridgeDir(
      join(extensionsDir, "liangxin.monitor-cursor-bridge-0.1.0")
    );

    const result = ensureCursorBridgeInstalled({
      env: {
        MONITOR_CURSOR_EXTENSIONS_DIR: extensionsDir
      }
    });

    expect(result).toEqual({
      installed: false,
      targetDir: resolveCursorBridgeTargetDir(
        {
          MONITOR_CURSOR_EXTENSIONS_DIR: extensionsDir
        },
        extensionsDir
      )
    });
    expect(isCursorBridgeInstalled({ MONITOR_CURSOR_EXTENSIONS_DIR: extensionsDir })).toBe(true);
  });
});
