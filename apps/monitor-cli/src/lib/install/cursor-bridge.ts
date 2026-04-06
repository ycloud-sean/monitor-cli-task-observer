import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CURSOR_BRIDGE_EXTENSION_DIRNAME = "liangxin.monitor-cursor-bridge-0.1.0";

function isCursorBridgeSourceDir(path: string): boolean {
  return existsSync(join(path, "package.json")) && existsSync(join(path, "extension.js"));
}

function collectDirectoryFiles(rootDir: string, currentDir = rootDir): string[] {
  return readdirSync(currentDir, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        return collectDirectoryFiles(rootDir, entryPath);
      }
      if (!entry.isFile()) {
        return [];
      }
      return [entryPath.slice(rootDir.length + 1)];
    })
    .sort();
}

function buildDirectorySignature(rootDir: string): string | null {
  if (!isCursorBridgeSourceDir(rootDir)) {
    return null;
  }

  const hash = createHash("sha256");
  for (const relativePath of collectDirectoryFiles(rootDir)) {
    const absolutePath = join(rootDir, relativePath);
    const stat = statSync(absolutePath);
    hash.update(relativePath);
    hash.update("\0");
    hash.update(String(stat.mode));
    hash.update("\0");
    hash.update(readFileSync(absolutePath));
    hash.update("\0");
  }

  return hash.digest("hex");
}

export function resolveCursorExtensionsDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.MONITOR_CURSOR_EXTENSIONS_DIR || join(homedir(), ".cursor", "extensions");
}

export function resolveCursorBridgeTargetDir(
  env: NodeJS.ProcessEnv = process.env,
  extensionsDir: string = resolveCursorExtensionsDir(env)
): string {
  return join(extensionsDir, CURSOR_BRIDGE_EXTENSION_DIRNAME);
}

export function resolveCursorBridgeSourceDir(
  moduleUrl: string = import.meta.url,
  env: NodeJS.ProcessEnv = process.env
): string {
  const moduleDir = dirname(fileURLToPath(moduleUrl));
  const envSourceDir = env.MONITOR_CURSOR_BRIDGE_SOURCE_DIR;
  const candidates = [
    envSourceDir,
    resolve(moduleDir, "../../../monitor-cursor-extension"),
    resolve(moduleDir, "../../../../monitor-cursor-extension")
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (isCursorBridgeSourceDir(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `failed to locate Cursor bridge source directory; checked: ${candidates.join(", ")}`
  );
}

export function installCursorBridge(options: {
  moduleUrl?: string;
  env?: NodeJS.ProcessEnv;
  extensionsDir?: string;
} = {}): { sourceDir: string; targetDir: string } {
  const env = options.env ?? process.env;
  const sourceDir = resolveCursorBridgeSourceDir(options.moduleUrl, env);
  const extensionsDir = options.extensionsDir ?? resolveCursorExtensionsDir(env);
  const targetDir = resolveCursorBridgeTargetDir(env, extensionsDir);

  mkdirSync(extensionsDir, { recursive: true });
  rmSync(targetDir, { recursive: true, force: true });
  cpSync(sourceDir, targetDir, { recursive: true });

  return { sourceDir, targetDir };
}

export function isCursorBridgeInstalled(
  env: NodeJS.ProcessEnv = process.env,
  extensionsDir?: string
): boolean {
  const targetDir = resolveCursorBridgeTargetDir(env, extensionsDir);
  return isCursorBridgeSourceDir(targetDir);
}

export function isCursorBridgeCurrent(options: {
  moduleUrl?: string;
  env?: NodeJS.ProcessEnv;
  extensionsDir?: string;
} = {}): boolean {
  const env = options.env ?? process.env;
  const extensionsDir = options.extensionsDir ?? resolveCursorExtensionsDir(env);
  const targetDir = resolveCursorBridgeTargetDir(env, extensionsDir);
  if (!isCursorBridgeSourceDir(targetDir)) {
    return false;
  }

  const sourceDir = resolveCursorBridgeSourceDir(options.moduleUrl, env);
  const sourceSignature = buildDirectorySignature(sourceDir);
  const targetSignature = buildDirectorySignature(targetDir);
  return Boolean(sourceSignature && targetSignature && sourceSignature === targetSignature);
}

export function ensureCursorBridgeInstalled(options: {
  moduleUrl?: string;
  env?: NodeJS.ProcessEnv;
  extensionsDir?: string;
} = {}): { installed: boolean; reason: "missing" | "outdated" | "current"; targetDir: string } {
  const env = options.env ?? process.env;
  const extensionsDir = options.extensionsDir ?? resolveCursorExtensionsDir(env);
  const targetDir = resolveCursorBridgeTargetDir(env, extensionsDir);
  const wasInstalled = isCursorBridgeInstalled(env, extensionsDir);

  if (wasInstalled && isCursorBridgeCurrent(options)) {
    return { installed: false, reason: "current", targetDir };
  }

  installCursorBridge({
    moduleUrl: options.moduleUrl,
    env,
    extensionsDir
  });
  return {
    installed: true,
    reason: wasInstalled ? "outdated" : "missing",
    targetDir
  };
}
