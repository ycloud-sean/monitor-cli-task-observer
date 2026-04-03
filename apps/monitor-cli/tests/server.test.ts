import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TaskRecord } from "@monitor/contracts";
import { createDaemonServer } from "../src/lib/server.js";

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
        body: JSON.stringify({
          type: "task.started",
          taskId: "task-1",
          at: "2026-04-03T08:00:00.000Z",
          payload: {
            taskId: "task-1",
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
        })
      });

      const response = await fetch(`${baseUrl}/tasks`);
      const tasks = (await response.json()) as TaskRecord[];

      expect(tasks).toEqual([
        {
          taskId: "task-1",
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
      ]);
    } finally {
      await server.close();
    }
  });
});
