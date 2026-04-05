import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  buildDaemonHealthUrl,
  ensureDaemonRunning,
  parseLocalDaemonUrl,
  resolveMonitordScriptPath,
  waitForDaemonHealthy
} from "../src/lib/daemon.js";

class FakeChildProcess extends EventEmitter {
  unref(): void {
    // no-op for tests
  }
}

describe("daemon helpers", () => {
  it("builds a health url from the daemon base url", () => {
    expect(buildDaemonHealthUrl("http://127.0.0.1:45731")).toBe(
      "http://127.0.0.1:45731/health"
    );
  });

  it("parses only local http daemon urls for automatic startup", () => {
    expect(parseLocalDaemonUrl("http://127.0.0.1:45731")).toEqual({
      host: "127.0.0.1",
      port: 45731
    });
    expect(parseLocalDaemonUrl("http://localhost:45731")).toEqual({
      host: "localhost",
      port: 45731
    });
    expect(parseLocalDaemonUrl("https://example.com")).toBeNull();
    expect(parseLocalDaemonUrl("http://10.0.0.1:45731")).toBeNull();
  });

  it("resolves monitord next to the current monitor entrypoint", () => {
    expect(
      resolveMonitordScriptPath("file:///tmp/monitor-cli/dist/bin/monitor.js")
    ).toBe("/tmp/monitor-cli/dist/bin/monitord.js");
  });

  it("waits until the daemon becomes healthy", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);
    const sleepImpl = vi.fn(async () => undefined);

    await expect(
      waitForDaemonHealthy("http://127.0.0.1:45731", {
        attempts: 3,
        delayMs: 1,
        fetchImpl: fetchImpl as unknown as (input: string) => Promise<{ ok: boolean }>,
        sleepImpl
      })
    ).resolves.toBe(true);

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleepImpl).toHaveBeenCalledTimes(1);
  });

  it("accepts a legacy daemon that exposes /tasks but not /health", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);

    await expect(
      waitForDaemonHealthy("http://127.0.0.1:45731", {
        attempts: 1,
        fetchImpl: fetchImpl as unknown as (input: string) => Promise<{ ok: boolean }>
      })
    ).resolves.toBe(true);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not spawn a daemon when one is already healthy", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        pid: 321,
        scriptPath: "/tmp/monitor-cli/dist/bin/monitord.js"
      })
    }));
    const spawnProcess = vi.fn();

    await ensureDaemonRunning({
      baseUrl: "http://127.0.0.1:45731",
      moduleUrl: "file:///tmp/monitor-cli/dist/bin/monitor.js",
      fetchImpl: fetchImpl as unknown as (input: string) => Promise<{ ok: boolean }>,
      spawnProcess: spawnProcess as unknown as typeof import("node:child_process").spawn
    });

    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("replaces a healthy daemon from a different installation before spawning the current one", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          pid: 456,
          scriptPath: "/tmp/legacy-monitor/dist/bin/monitord.js"
        })
      })
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          pid: 789,
          scriptPath: "/tmp/monitor-cli/dist/bin/monitord.js"
        })
      });
    const sleepImpl = vi.fn(async () => undefined);
    const spawnProcess = vi.fn(() => {
      const child = new FakeChildProcess();
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });
    const killProcess = vi.fn();

    await ensureDaemonRunning({
      baseUrl: "http://127.0.0.1:45731",
      moduleUrl: "file:///tmp/monitor-cli/dist/bin/monitor.js",
      processExecPath: "/usr/local/bin/node",
      fetchImpl: fetchImpl as unknown as (input: string) => Promise<{ ok: boolean }>,
      sleepImpl,
      spawnProcess: spawnProcess as unknown as typeof import("node:child_process").spawn,
      killProcess,
      startupAttempts: 2,
      startupDelayMs: 1
    });

    expect(killProcess).toHaveBeenCalledWith(456, "SIGTERM");
    expect(spawnProcess).toHaveBeenCalledWith(
      "/usr/local/bin/node",
      ["/tmp/monitor-cli/dist/bin/monitord.js"],
      expect.objectContaining({
        detached: true,
        stdio: "ignore",
        env: expect.objectContaining({
          MONITOR_PORT: "45731"
        })
      })
    );
  });

  it("spawns monitord and waits for health when the local daemon is down", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);
    const sleepImpl = vi.fn(async () => undefined);
    const spawnProcess = vi.fn(() => {
      const child = new FakeChildProcess();
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });

    await expect(
      ensureDaemonRunning({
        baseUrl: "http://127.0.0.1:45731",
        moduleUrl: "file:///tmp/monitor-cli/dist/bin/monitor.js",
        processExecPath: "/usr/local/bin/node",
        env: { MONITOR_DATA_DIR: "/tmp/monitor-data" },
        fetchImpl: fetchImpl as unknown as (input: string) => Promise<{ ok: boolean }>,
        sleepImpl,
        spawnProcess: spawnProcess as unknown as typeof import("node:child_process").spawn,
        startupAttempts: 2,
        startupDelayMs: 1
      })
    ).resolves.toBeUndefined();

    expect(spawnProcess).toHaveBeenCalledWith(
      "/usr/local/bin/node",
      ["/tmp/monitor-cli/dist/bin/monitord.js"],
      {
        detached: true,
        stdio: "ignore",
        env: {
          MONITOR_DATA_DIR: "/tmp/monitor-data",
          MONITOR_PORT: "45731"
        }
      }
    );
  });

  it("fails fast when automatic startup is requested for a non-local daemon url", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });

    await expect(
      ensureDaemonRunning({
        baseUrl: "https://monitor.example.com",
        moduleUrl: "file:///tmp/monitor-cli/dist/bin/monitor.js",
        fetchImpl: fetchImpl as unknown as (input: string) => Promise<{ ok: boolean }>
      })
    ).rejects.toThrow("automatic startup only supports local");
  });

  it("falls back to lsof when replacing a legacy daemon without health metadata", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          pid: 987,
          scriptPath: "/tmp/monitor-cli/dist/bin/monitord.js"
        })
      });
    const sleepImpl = vi.fn(async () => undefined);
    const spawnProcess = vi.fn(() => {
      const child = new FakeChildProcess();
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });
    const killProcess = vi.fn();
    const execFileImpl = vi.fn(async () => ({ stdout: "p654\n", stderr: "" }));

    await ensureDaemonRunning({
      baseUrl: "http://127.0.0.1:45731",
      moduleUrl: "file:///tmp/monitor-cli/dist/bin/monitor.js",
      processExecPath: "/usr/local/bin/node",
      fetchImpl: fetchImpl as unknown as (input: string) => Promise<{ ok: boolean }>,
      sleepImpl,
      spawnProcess: spawnProcess as unknown as typeof import("node:child_process").spawn,
      execFileImpl,
      killProcess,
      startupAttempts: 2,
      startupDelayMs: 1
    });

    expect(execFileImpl).toHaveBeenCalledWith("lsof", [
      "-nP",
      "-iTCP:45731",
      "-sTCP:LISTEN",
      "-Fp"
    ]);
    expect(killProcess).toHaveBeenCalledWith(654, "SIGTERM");
    expect(spawnProcess).toHaveBeenCalledOnce();
  });
});
