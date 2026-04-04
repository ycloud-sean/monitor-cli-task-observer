import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CURSOR_BRIDGE_EXTENSION_DIRNAME = "liangxin.monitor-cursor-bridge-0.1.0";

function isCursorBridgeSourceDir(path: string): boolean {
  return existsSync(join(path, "package.json")) && existsSync(join(path, "extension.js"));
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

export function ensureCursorBridgeInstalled(options: {
  moduleUrl?: string;
  env?: NodeJS.ProcessEnv;
  extensionsDir?: string;
} = {}): { installed: boolean; targetDir: string } {
  const env = options.env ?? process.env;
  const extensionsDir = options.extensionsDir ?? resolveCursorExtensionsDir(env);
  const targetDir = resolveCursorBridgeTargetDir(env, extensionsDir);

  if (isCursorBridgeInstalled(env, extensionsDir)) {
    return { installed: false, targetDir };
  }

  installCursorBridge({
    moduleUrl: options.moduleUrl,
    env,
    extensionsDir
  });
  return { installed: true, targetDir };
}
