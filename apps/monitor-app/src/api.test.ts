import { describe, expect, it, vi } from "vitest";
import { fetchTasks, resolveDaemonBaseUrl } from "./api";

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
