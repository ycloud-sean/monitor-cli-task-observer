const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const {
  PENDING_FOCUS_REQUEST_TTL_MS,
  enqueuePendingFocusRequest,
  getPendingFocusRequestStorePath,
  pruneExpiredPendingFocusRequests,
  readPendingFocusRequests,
  writePendingFocusRequests
} = require("../lib/focus-queue");

test("enqueuePendingFocusRequest stores a request with expiry metadata", () => {
  const requests = new Map();
  const now = 1000;

  assert.equal(
    enqueuePendingFocusRequest(requests, {
      taskId: "task-1",
      cwd: "/tmp/project",
      monitorPid: "4321",
      windowRef: "cursor-window:{}"
    }, now),
    true
  );

  assert.deepEqual(requests.get("task-1"), {
    taskId: "task-1",
    cwd: "/tmp/project",
    monitorPid: "4321",
    windowRef: "cursor-window:{}",
    requestedAt: now,
    expiresAt: now + PENDING_FOCUS_REQUEST_TTL_MS
  });
});

test("pruneExpiredPendingFocusRequests removes only expired requests", () => {
  const requests = new Map([
    [
      "expired",
      {
        taskId: "expired",
        cwd: null,
        monitorPid: null,
        windowRef: null,
        requestedAt: 100,
        expiresAt: 200
      }
    ],
    [
      "active",
      {
        taskId: "active",
        cwd: null,
        monitorPid: null,
        windowRef: null,
        requestedAt: 100,
        expiresAt: 400
      }
    ]
  ]);

  assert.equal(pruneExpiredPendingFocusRequests(requests, 300), true);
  assert.equal(requests.has("expired"), false);
  assert.equal(requests.has("active"), true);
});

test("readPendingFocusRequests and writePendingFocusRequests round-trip the queue", async () => {
  const dir = mkdtempSync(join(tmpdir(), "monitor-focus-queue-"));
  const storePath = getPendingFocusRequestStorePath(dir);
  const requests = new Map();

  enqueuePendingFocusRequest(
    requests,
    {
      taskId: "task-1",
      cwd: "/tmp/project",
      monitorPid: "4321",
      windowRef: "cursor-window:{}"
    },
    1000
  );

  try {
    await writePendingFocusRequests(storePath, requests);
    const reloaded = await readPendingFocusRequests(storePath);
    assert.deepEqual(reloaded.get("task-1"), requests.get("task-1"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
