import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { TaskEvent, TaskRecord } from "@monitor/contracts";
import { createDaemonServer } from "../src/lib/server.js";
import { DaemonClient } from "../src/lib/http-client.js";
import { Persistence } from "../src/lib/persistence.js";

type TaskStartedEvent = Extract<TaskEvent, { type: "task.started" }>;

function makeTaskStartedEvent(taskId = "task-1"): TaskStartedEvent {
  return {
    type: "task.started",
    taskId,
    at: "2026-04-03T08:00:00.000Z",
    payload: {
      taskId,
      name: "api-fix",
      runnerType: "codex",
      rawCommand: ["codex"],
      cwd: "/tmp/project",
      pid: 123,
      hostApp: "terminal",
      hostWindowRef: "window-1",
      hostSessionRef: "tab-1",
      startedAt: "2026-04-03T08:00:00.000Z",
      lastEventAt: "2026-04-03T08:00:00.000Z",
      status: "running",
      lastOutputExcerpt: ""
    }
  };
}

function expectedTask(taskId = "task-1"): TaskRecord {
  return {
    taskId,
    name: "api-fix",
    runnerType: "codex",
    rawCommand: ["codex"],
    cwd: "/tmp/project",
    pid: 123,
    hostApp: "terminal",
    hostWindowRef: "window-1",
    hostSessionRef: "tab-1",
    startedAt: "2026-04-03T08:00:00.000Z",
    lastEventAt: "2026-04-03T08:00:00.000Z",
    status: "running",
    lastOutputExcerpt: ""
  };
}

describe("daemon server", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("accepts task events and returns tasks", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "monitor-daemon-"));
    dirs.push(dataDir);
    const server = await createDaemonServer({ port: 0, dataDir });

    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      await fetch(`${baseUrl}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(makeTaskStartedEvent())
      });

      const response = await fetch(`${baseUrl}/tasks`);
      const tasks = (await response.json()) as TaskRecord[];

      expect(tasks).toEqual([expectedTask()]);
    } finally {
      await server.close();
    }
  });

  it("reports daemon health for local startup probes", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "monitor-daemon-"));
    dirs.push(dataDir);
    const server = await createDaemonServer({ port: 0, dataDir });

    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const response = await fetch(`${baseUrl}/health`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
    } finally {
      await server.close();
    }
  });

  it("returns 400 for malformed events JSON and remains usable", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "monitor-daemon-"));
    dirs.push(dataDir);
    const server = await createDaemonServer({ port: 0, dataDir });

    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const badResponse = await fetch(`${baseUrl}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ invalid-json"
      });
      const badBody = (await badResponse.json()) as { error: string };

      expect(badResponse.status).toBe(400);
      expect(badBody.error).toBe("bad_request");

      const okResponse = await fetch(`${baseUrl}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(makeTaskStartedEvent())
      });
      expect(okResponse.status).toBe(202);

      const tasksResponse = await fetch(`${baseUrl}/tasks`);
      const tasks = (await tasksResponse.json()) as TaskRecord[];
      expect(tasks).toEqual([expectedTask()]);
    } finally {
      await server.close();
    }
  });

  it("rejects malformed task.started payloads", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "monitor-daemon-"));
    dirs.push(dataDir);
    const server = await createDaemonServer({ port: 0, dataDir });

    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const mismatchedTaskId = makeTaskStartedEvent("task-1");
      mismatchedTaskId.payload.taskId = "task-2";
      const mismatchResponse = await fetch(`${baseUrl}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mismatchedTaskId)
      });
      expect(mismatchResponse.status).toBe(400);

      const invalidRecord = makeTaskStartedEvent("task-3");
      (invalidRecord.payload as unknown as { runnerType: unknown }).runnerType = "bad";
      const invalidRecordResponse = await fetch(`${baseUrl}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(invalidRecord)
      });
      expect(invalidRecordResponse.status).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("rejects task.started when payload timestamps are not canonical ISO strings", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "monitor-daemon-"));
    dirs.push(dataDir);
    const server = await createDaemonServer({ port: 0, dataDir });

    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;

      const invalidStartedAt = makeTaskStartedEvent("task-bad-started-at");
      invalidStartedAt.payload.startedAt = "2026-4-3T08:00:00Z";
      const invalidStartedAtResponse = await fetch(`${baseUrl}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(invalidStartedAt)
      });
      expect(invalidStartedAtResponse.status).toBe(400);

      const invalidLastEventAt = makeTaskStartedEvent("task-bad-last-event-at");
      invalidLastEventAt.payload.lastEventAt = "not-a-timestamp";
      const invalidLastEventAtResponse = await fetch(`${baseUrl}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(invalidLastEventAt)
      });
      expect(invalidLastEventAtResponse.status).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("rejects task.started when event.at differs from payload.lastEventAt", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "monitor-daemon-"));
    dirs.push(dataDir);
    const server = await createDaemonServer({ port: 0, dataDir });

    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const mismatchedEvent = makeTaskStartedEvent("task-time-mismatch");
      mismatchedEvent.payload.lastEventAt = "2026-04-03T08:00:01.000Z";

      const response = await fetch(`${baseUrl}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mismatchedEvent)
      });
      expect(response.status).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("rejects non-start events with invalid event.at timestamps", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "monitor-daemon-"));
    dirs.push(dataDir);
    const server = await createDaemonServer({ port: 0, dataDir });

    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const startedResponse = await fetch(`${baseUrl}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(makeTaskStartedEvent("task-invalid-at"))
      });
      expect(startedResponse.status).toBe(202);

      const invalidAtEvent: TaskEvent = {
        type: "task.finished",
        taskId: "task-invalid-at",
        at: "2026-04-03 08:01:00"
      };
      const response = await fetch(`${baseUrl}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(invalidAtEvent)
      });
      expect(response.status).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("hydrates tasks from sqlite on restart", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "monitor-daemon-"));
    dirs.push(dataDir);

    const firstServer = await createDaemonServer({ port: 0, dataDir });
    const baseUrl1 = `http://127.0.0.1:${firstServer.port}`;
    await fetch(`${baseUrl1}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makeTaskStartedEvent("task-restart"))
    });
    await firstServer.close();

    const secondServer = await createDaemonServer({ port: 0, dataDir });
    try {
      const baseUrl2 = `http://127.0.0.1:${secondServer.port}`;
      const response = await fetch(`${baseUrl2}/tasks`);
      const tasks = (await response.json()) as TaskRecord[];

      expect(tasks).toEqual([expectedTask("task-restart")]);
    } finally {
      await secondServer.close();
    }
  });

  it("daemon client throws on non-ok http responses", async () => {
    const failingServer = createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/events") {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: "unavailable" }));
        return;
      }
      if (req.url === "/tasks") {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: "boom" }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not_found" }));
    });
    await new Promise<void>((resolve, reject) => {
      failingServer.once("error", reject);
      failingServer.listen(0, "127.0.0.1", resolve);
    });
    const address = failingServer.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to bind test server");
    }

    const client = new DaemonClient(`http://127.0.0.1:${address.port}`);

    try {
      await expect(client.listTasks()).rejects.toThrow("HTTP 500");
      await expect(client.postEvent(makeTaskStartedEvent())).rejects.toThrow(
        "HTTP 503"
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        failingServer.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it("rolls back event persistence when saving task snapshot fails", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "monitor-daemon-"));
    dirs.push(dataDir);

    const saveTaskOriginal = Persistence.prototype.saveTask;
    let failOnce = true;
    Persistence.prototype.saveTask = function patchedSaveTask(task) {
      if (failOnce && task.taskId === "task-atomic") {
        failOnce = false;
        throw new Error("injected saveTask failure");
      }
      return saveTaskOriginal.call(this, task);
    };

    try {
      const server = await createDaemonServer({ port: 0, dataDir });
      try {
        const baseUrl = `http://127.0.0.1:${server.port}`;
        const failedResponse = await fetch(`${baseUrl}/events`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(makeTaskStartedEvent("task-atomic"))
        });
        expect(failedResponse.status).toBe(500);

        const tasksResponse = await fetch(`${baseUrl}/tasks`);
        const tasks = (await tasksResponse.json()) as TaskRecord[];
        expect(tasks).toEqual([]);
      } finally {
        await server.close();
      }
    } finally {
      Persistence.prototype.saveTask = saveTaskOriginal;
    }

    const db = new Database(join(dataDir, "monitor.sqlite"), { readonly: true });
    try {
      const eventRows = db
        .prepare<unknown[], { c: number }>(
          "select count(*) as c from task_events where task_id = ?"
        )
        .get("task-atomic");
      const taskRows = db
        .prepare<unknown[], { c: number }>("select count(*) as c from tasks where task_id = ?")
        .get("task-atomic");
      if (!eventRows || !taskRows) {
        throw new Error("failed to fetch sqlite row counts");
      }
      expect(eventRows.c).toBe(0);
      expect(taskRows.c).toBe(0);
    } finally {
      db.close();
    }
  });

  it("rejects when daemon server cannot bind to the requested port", async () => {
    const dataDir1 = mkdtempSync(join(tmpdir(), "monitor-daemon-"));
    const dataDir2 = mkdtempSync(join(tmpdir(), "monitor-daemon-"));
    dirs.push(dataDir1, dataDir2);
    const first = await createDaemonServer({ port: 0, dataDir: dataDir1 });

    try {
      await expect(
        createDaemonServer({ port: first.port, dataDir: dataDir2 })
      ).rejects.toThrow();
    } finally {
      await first.close();
    }
  });
});
