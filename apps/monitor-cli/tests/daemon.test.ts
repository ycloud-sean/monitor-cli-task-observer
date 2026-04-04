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

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleepImpl).toHaveBeenCalledTimes(2);
  });

  it("does not spawn a daemon when one is already healthy", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true } as Response));
    const spawnProcess = vi.fn();

    await ensureDaemonRunning({
      baseUrl: "http://127.0.0.1:45731",
      moduleUrl: "file:///tmp/monitor-cli/dist/bin/monitor.js",
      fetchImpl: fetchImpl as unknown as (input: string) => Promise<{ ok: boolean }>,
      spawnProcess: spawnProcess as unknown as typeof import("node:child_process").spawn
    });

    expect(spawnProcess).not.toHaveBeenCalled();
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
});
