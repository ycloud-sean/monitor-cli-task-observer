import { describe, expect, it, vi } from "vitest";
import { fetchTasks, focusTask, resolveDaemonBaseUrl } from "./api";

describe("resolveDaemonBaseUrl", () => {
  it("allows overriding the daemon URL from env", () => {
    expect(resolveDaemonBaseUrl("http://127.0.0.1:9999")).toBe(
      "http://127.0.0.1:9999"
    );
  });
});

describe("fetchTasks", () => {
  it("throws on non-ok responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: "unavailable" })
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchTasks("http://127.0.0.1:45731")).rejects.toThrow("HTTP 503");

    vi.unstubAllGlobals();
  });
});

describe("focusTask", () => {
  it("posts to the focus endpoint for the selected task", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true })
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(focusTask("task 1", "http://127.0.0.1:45731")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:45731/tasks/task%201/focus",
      { method: "POST" }
    );

    vi.unstubAllGlobals();
  });

  it("returns false when the daemon cannot focus the task", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ ok: false, reason: "focus_failed" })
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(focusTask("task-1", "http://127.0.0.1:45731")).resolves.toBe(
      false
    );

    vi.unstubAllGlobals();
  });
});
