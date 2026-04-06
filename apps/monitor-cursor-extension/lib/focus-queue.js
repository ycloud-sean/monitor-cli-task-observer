const { mkdir, readFile, rename, writeFile } = require("node:fs/promises");
const { dirname, join } = require("node:path");

const PENDING_FOCUS_REQUESTS_FILE = "pending-focus-requests.json";
const PENDING_FOCUS_REQUEST_TTL_MS = 5000;

function getPendingFocusRequestStorePath(globalStorageFsPath) {
  if (typeof globalStorageFsPath !== "string" || !globalStorageFsPath) {
    return null;
  }

  return join(globalStorageFsPath, PENDING_FOCUS_REQUESTS_FILE);
}

function normalizePendingFocusRequest(taskId, value) {
  if (!taskId || !value || typeof value !== "object") {
    return null;
  }

  return {
    taskId,
    cwd: typeof value.cwd === "string" ? value.cwd : null,
    monitorPid: typeof value.monitorPid === "string" ? value.monitorPid : null,
    windowRef: typeof value.windowRef === "string" ? value.windowRef : null,
    requestedAt: Number.isFinite(value.requestedAt) ? value.requestedAt : 0,
    expiresAt: Number.isFinite(value.expiresAt) ? value.expiresAt : 0
  };
}

async function readPendingFocusRequests(
  storePath,
  readFileImpl = readFile
) {
  if (!storePath) {
    return new Map();
  }

  try {
    const raw = await readFileImpl(storePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return new Map();
    }

    return new Map(
      Object.entries(parsed)
        .map(([taskId, value]) => [taskId, normalizePendingFocusRequest(taskId, value)])
        .filter(([, value]) => Boolean(value))
    );
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return new Map();
    }

    return new Map();
  }
}

async function writePendingFocusRequests(
  storePath,
  requests,
  options = {}
) {
  if (!storePath) {
    return;
  }

  const mkdirImpl = options.mkdirImpl ?? mkdir;
  const writeFileImpl = options.writeFileImpl ?? writeFile;
  const renameImpl = options.renameImpl ?? rename;
  const serialized = Object.fromEntries(requests.entries());
  const tmpPath = `${storePath}.tmp-${process.pid}`;

  await mkdirImpl(dirname(storePath), { recursive: true });
  await writeFileImpl(tmpPath, JSON.stringify(serialized, null, 2), "utf8");
  await renameImpl(tmpPath, storePath);
}

function enqueuePendingFocusRequest(requests, parsed, now = Date.now()) {
  if (!parsed?.taskId) {
    return false;
  }

  requests.set(parsed.taskId, {
    taskId: parsed.taskId,
    cwd: typeof parsed.cwd === "string" ? parsed.cwd : null,
    monitorPid: typeof parsed.monitorPid === "string" ? parsed.monitorPid : null,
    windowRef: typeof parsed.windowRef === "string" ? parsed.windowRef : null,
    requestedAt: now,
    expiresAt: now + PENDING_FOCUS_REQUEST_TTL_MS
  });
  return true;
}

function pruneExpiredPendingFocusRequests(requests, now = Date.now()) {
  let changed = false;

  for (const [taskId, request] of requests.entries()) {
    if (!request?.expiresAt || request.expiresAt <= now) {
      requests.delete(taskId);
      changed = true;
    }
  }

  return changed;
}

module.exports = {
  PENDING_FOCUS_REQUEST_TTL_MS,
  enqueuePendingFocusRequest,
  getPendingFocusRequestStorePath,
  pruneExpiredPendingFocusRequests,
  readPendingFocusRequests,
  writePendingFocusRequests
};
