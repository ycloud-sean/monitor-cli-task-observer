import { describe, expect, it } from "vitest";
import type { TaskRecord } from "@monitor/contracts";
import { escapeHtml, renderError, renderTasks } from "./render";
import { buildTaskViewModel } from "./store";

describe("escapeHtml", () => {
  it("escapes task content before it is injected into markup", () => {
    expect(escapeHtml(`<script>alert("x")</script> & "q"`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;q&quot;"
    );
  });
});

describe("renderTasks", () => {
  it("escapes task fields before writing innerHTML", () => {
    const tasks: TaskRecord[] = [
      {
        taskId: `id"><script>alert(1)</script>`,
        name: `<img src=x onerror=alert(1)>`,
        runnerType: "codex",
        rawCommand: ["codex", `<svg/onload=alert(1)>`],
        cwd: `/tmp/<script>`,
        pid: 1,
        hostApp: "terminal",
        hostWindowRef: null,
        hostSessionRef: null,
        startedAt: "2026-04-03T08:00:00.000Z",
        lastEventAt: "2026-04-03T08:00:00.000Z",
        status: "running",
        lastOutputExcerpt: `<script>alert("x")</script>`
      }
    ];
    const root = { innerHTML: "" } as HTMLElement;

    renderTasks(root, buildTaskViewModel(tasks, tasks[0]?.taskId));

    expect(root.innerHTML).not.toContain("<script>");
    expect(root.innerHTML).not.toContain("<img");
    expect(root.innerHTML).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });
});

describe("renderError", () => {
  it("escapes error text before writing innerHTML", () => {
    const root = { innerHTML: "" } as HTMLElement;

    renderError(root, `<script>alert("boom")</script>`);

    expect(root.innerHTML).not.toContain("<script>");
    expect(root.innerHTML).toContain("&lt;script&gt;alert(&quot;boom&quot;)&lt;/script&gt;");
  });
});
