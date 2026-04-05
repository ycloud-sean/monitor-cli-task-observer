import { execFile, spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const LOCAL_DAEMON_HOSTS = new Set(["127.0.0.1", "localhost"]);
const DEFAULT_STARTUP_ATTEMPTS = 30;
const DEFAULT_STARTUP_DELAY_MS = 100;
const execFileAsync = promisify(execFile);

type FetchResponseLike = {
  ok: boolean;
  json?: () => Promise<unknown>;
};
type FetchLike = (input: string) => Promise<FetchResponseLike>;
type SpawnLike = typeof spawn;
type SleepLike = (ms: number) => Promise<void>;
type ExecFileLike = (
  file: string,
  args: string[]
) => Promise<{ stdout: string; stderr: string }>;
type KillLike = (pid: number, signal?: NodeJS.Signals) => void;
type DaemonProcessHandle = Pick<ChildProcess, "once" | "off" | "unref">;
type DaemonHealth = {
  ok: true;
  pid?: number;
  scriptPath?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseDaemonHealthPayload(payload: unknown): DaemonHealth {
  if (!isObject(payload) || payload.ok !== true) {
    return { ok: true };
  }

  const pid =
    typeof payload.pid === "number" &&
    Number.isInteger(payload.pid) &&
    payload.pid > 0
      ? payload.pid
      : undefined;
  const scriptPath =
    typeof payload.scriptPath === "string" && payload.scriptPath.length > 0
      ? payload.scriptPath
      : undefined;

  return {
    ok: true,
    pid,
    scriptPath
  };
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

async function readDaemonHealth(
  baseUrl: string,
  fetchImpl: FetchLike = fetch as FetchLike
): Promise<DaemonHealth | null> {
  try {
    const healthResponse = await fetchImpl(buildDaemonHealthUrl(baseUrl));
    if (healthResponse.ok) {
      if (typeof healthResponse.json === "function") {
        try {
          return parseDaemonHealthPayload(await healthResponse.json());
        } catch {
          return { ok: true };
        }
      }

      return { ok: true };
    }
  } catch {
    // Fall through to the legacy probe.
  }

  try {
    const tasksResponse = await fetchImpl(buildDaemonTasksUrl(baseUrl));
    return tasksResponse.ok ? { ok: true } : null;
  } catch {
    return null;
  }
}

export async function isDaemonHealthy(
  baseUrl: string,
  fetchImpl: FetchLike = fetch as FetchLike
): Promise<boolean> {
  return (await readDaemonHealth(baseUrl, fetchImpl)) !== null;
}

async function waitForDaemonUnavailable(
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
    if ((await readDaemonHealth(baseUrl, fetchImpl)) === null) {
      return true;
    }

    if (attempt < attempts - 1) {
      await sleepImpl(delayMs);
    }
  }

  return false;
}

async function findListeningDaemonPid(
  port: number,
  execFileImpl: ExecFileLike = (file, args) => execFileAsync(file, args)
): Promise<number | null> {
  try {
    const { stdout } = await execFileImpl("lsof", [
      "-nP",
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
      "-Fp"
    ]);
    for (const line of stdout.split(/\r?\n/)) {
      if (!line.startsWith("p")) continue;
      const pid = Number(line.slice(1));
      if (Number.isInteger(pid) && pid > 0) {
        return pid;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function daemonMatchesScript(
  health: DaemonHealth,
  expectedScriptPath: string
): boolean {
  return health.scriptPath === expectedScriptPath;
}

async function replaceLocalDaemon(options: {
  baseUrl: string;
  localPort: number;
  currentHealth: DaemonHealth;
  expectedScriptPath: string;
  fetchImpl: FetchLike;
  sleepImpl: SleepLike;
  execFileImpl?: ExecFileLike;
  killProcess?: KillLike;
  startupAttempts: number;
  startupDelayMs: number;
}): Promise<void> {
  const {
    baseUrl,
    localPort,
    currentHealth,
    fetchImpl,
    sleepImpl,
    execFileImpl,
    killProcess = process.kill.bind(process),
    startupAttempts,
    startupDelayMs
  } = options;

  const pid = currentHealth.pid ?? (await findListeningDaemonPid(localPort, execFileImpl));
  if (!pid) {
    throw new Error(
      `monitor daemon at ${baseUrl} is not the current installation, but its pid could not be determined`
    );
  }

  try {
    killProcess(pid, "SIGTERM");
  } catch (error) {
    const code =
      isObject(error) && typeof error.code === "string" ? error.code : undefined;
    if (code !== "ESRCH") {
      throw error;
    }
  }

  const stopped = await waitForDaemonUnavailable(baseUrl, {
    attempts: startupAttempts,
    delayMs: startupDelayMs,
    fetchImpl,
    sleepImpl
  });

  if (!stopped) {
    throw new Error(
      `monitor daemon at ${baseUrl} did not stop after replacing ${currentHealth.scriptPath ?? "legacy daemon"}`
    );
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
    if ((await readDaemonHealth(baseUrl, fetchImpl)) !== null) {
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
  execFileImpl?: ExecFileLike;
  killProcess?: KillLike;
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
    execFileImpl = (file, args) => execFileAsync(file, args),
    killProcess = process.kill.bind(process),
    startupAttempts = DEFAULT_STARTUP_ATTEMPTS,
    startupDelayMs = DEFAULT_STARTUP_DELAY_MS
  } = options;

  const expectedScriptPath = resolveMonitordScriptPath(moduleUrl);
  const currentHealth = await readDaemonHealth(baseUrl, fetchImpl);
  const localDaemon = parseLocalDaemonUrl(baseUrl);

  if (currentHealth && (!localDaemon || daemonMatchesScript(currentHealth, expectedScriptPath))) {
    return;
  }

  if (!localDaemon) {
    throw new Error(
      `monitor daemon is unavailable at ${baseUrl}; automatic startup only supports local http://127.0.0.1 or http://localhost urls`
    );
  }

  if (currentHealth) {
    await replaceLocalDaemon({
      baseUrl,
      localPort: localDaemon.port,
      currentHealth,
      expectedScriptPath,
      fetchImpl,
      sleepImpl,
      execFileImpl,
      killProcess,
      startupAttempts,
      startupDelayMs
    });
  }

  await spawnDetached(
    processExecPath,
    [expectedScriptPath],
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
