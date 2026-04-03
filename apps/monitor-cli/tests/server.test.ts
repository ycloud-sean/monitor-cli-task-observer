import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TaskEvent, TaskRecord } from "@monitor/contracts";
import { createDaemonServer } from "../src/lib/server.js";
import { DaemonClient } from "../src/lib/http-client.js";

function makeTaskStartedEvent(taskId = "task-1"): TaskEvent {
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
