import { describe, expect, it } from "vitest";
import { parseTaskUrl } from "./deep-link";

describe("parseTaskUrl", () => {
  it("extracts task ids from monitor deep links", () => {
    expect(parseTaskUrl("monitor://task/task-123")).toEqual({
      taskId: "task-123"
    });
    expect(parseTaskUrl("https://example.com")).toBeNull();
  });
});
