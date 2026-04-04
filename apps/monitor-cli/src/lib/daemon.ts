import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

const LOCAL_DAEMON_HOSTS = new Set(["127.0.0.1", "localhost"]);
const DEFAULT_STARTUP_ATTEMPTS = 30;
const DEFAULT_STARTUP_DELAY_MS = 100;

type FetchLike = (input: string) => Promise<{ ok: boolean }>;
type SpawnLike = typeof spawn;
type SleepLike = (ms: number) => Promise<void>;
type DaemonProcessHandle = Pick<ChildProcess, "once" | "off" | "unref">;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function spawnDetached(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  spawnProcess: SpawnLike
): Promise<void> {
  const child = spawnProcess(command, args, {
    detached: true,
    stdio: "ignore",
    env
  }) as DaemonProcessHandle;

  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const resolveOnSpawn = () => {
      if (settled) return;
      settled = true;
      child.off("error", rejectOnError);
      child.unref();
      resolve();
    };

    const rejectOnError = (error: Error) => {
      if (settled) return;
      settled = true;
      child.off("spawn", resolveOnSpawn);
      reject(error);
    };

    child.once("spawn", resolveOnSpawn);
    child.once("error", rejectOnError);
  });
}

export function buildDaemonHealthUrl(baseUrl: string): string {
  return new URL("/health", baseUrl).toString();
}

function buildDaemonTasksUrl(baseUrl: string): string {
  return new URL("/tasks", baseUrl).toString();
}

export function parseLocalDaemonUrl(baseUrl: string): { host: string; port: number } | null {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" || !LOCAL_DAEMON_HOSTS.has(url.hostname)) {
      return null;
    }

    const port = Number(url.port || "80");
    if (!Number.isInteger(port) || port <= 0) {
      return null;
    }

    return {
      host: url.hostname,
      port
    };
  } catch {
    return null;
  }
}

export function resolveMonitordScriptPath(moduleUrl: string): string {
  return fileURLToPath(new URL("./monitord.js", moduleUrl));
}

export async function isDaemonHealthy(
  baseUrl: string,
  fetchImpl: FetchLike = fetch as FetchLike
): Promise<boolean> {
  try {
    const healthResponse = await fetchImpl(buildDaemonHealthUrl(baseUrl));
    if (healthResponse.ok) {
      return true;
    }
  } catch {
    // Fall through to the legacy probe.
  }

  try {
    const tasksResponse = await fetchImpl(buildDaemonTasksUrl(baseUrl));
    return tasksResponse.ok;
  } catch {
    return false;
  }
}

export async function waitForDaemonHealthy(
  baseUrl: string,
  options: {
    attempts?: number;
    delayMs?: number;
    fetchImpl?: FetchLike;
    sleepImpl?: SleepLike;
  } = {}
): Promise<boolean> {
  const attempts = options.attempts ?? DEFAULT_STARTUP_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_STARTUP_DELAY_MS;
  const fetchImpl = options.fetchImpl ?? (fetch as FetchLike);
  const sleepImpl = options.sleepImpl ?? sleep;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await isDaemonHealthy(baseUrl, fetchImpl)) {
      return true;
    }

    if (attempt < attempts - 1) {
      await sleepImpl(delayMs);
    }
  }

  return false;
}

export async function ensureDaemonRunning(options: {
  baseUrl: string;
  moduleUrl: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  sleepImpl?: SleepLike;
  spawnProcess?: SpawnLike;
  processExecPath?: string;
  startupAttempts?: number;
  startupDelayMs?: number;
}): Promise<void> {
  const {
    baseUrl,
    moduleUrl,
    env = process.env,
    fetchImpl = fetch as FetchLike,
    sleepImpl = sleep,
    spawnProcess = spawn,
    processExecPath = process.execPath,
    startupAttempts = DEFAULT_STARTUP_ATTEMPTS,
    startupDelayMs = DEFAULT_STARTUP_DELAY_MS
  } = options;

  if (await isDaemonHealthy(baseUrl, fetchImpl)) {
    return;
  }

  const localDaemon = parseLocalDaemonUrl(baseUrl);
  if (!localDaemon) {
    throw new Error(
      `monitor daemon is unavailable at ${baseUrl}; automatic startup only supports local http://127.0.0.1 or http://localhost urls`
    );
  }

  await spawnDetached(
    processExecPath,
    [resolveMonitordScriptPath(moduleUrl)],
    {
      ...env,
      MONITOR_PORT: String(localDaemon.port)
    },
    spawnProcess
  );

  const healthy = await waitForDaemonHealthy(baseUrl, {
    attempts: startupAttempts,
    delayMs: startupDelayMs,
    fetchImpl,
    sleepImpl
  });

  if (!healthy) {
    throw new Error(`monitor daemon did not become healthy at ${baseUrl}`);
  }
}
