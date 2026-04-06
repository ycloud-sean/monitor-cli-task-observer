import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskRecord } from "@monitor/contracts";

function makeTask(
  overrides: Partial<TaskRecord> = {}
): TaskRecord {
  return {
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
    status: "finished",
    lastOutputExcerpt: "",
    ...overrides
  };
}

function mockExecFileWithFrontmostGate(processName: string) {
  return vi.fn((_command: string, args: string[], callback: Function) => {
    const script = args.join("\n");
    const hasFrontmostCheck = script.includes(
      `frontmost of process "${processName}"`
    );
    queueMicrotask(() =>
      callback(null, {
        stdout: hasFrontmostCheck ? "false\n" : "true\n",
        stderr: ""
      })
    );
  });
}

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unmock("node:child_process");
});

describe("notifyTask", () => {
  it("returns once the notifier process has spawned", async () => {
    const spawn = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = vi.fn();
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });
    const execFile = vi.fn();

    vi.doMock("node:child_process", () => ({ spawn, execFile }));

    const { notifyTask } = await import("../src/lib/notification.js");
    const outcome = await Promise.race([
      notifyTask(makeTask()).then(() => "resolved"),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 50))
    ]);

    expect(outcome).toBe("resolved");
    expect(spawn).toHaveBeenCalledWith(
      expect.stringContaining(
        "terminal-notifier.app/Contents/MacOS/terminal-notifier"
      ),
      expect.arrayContaining([
        "-title",
        "Monitor",
        "-message",
        "api-fix finished",
        "-group",
        "task-1",
        "-open",
        "monitor://task/task-1"
      ]),
      expect.objectContaining({
        detached: true,
        stdio: "ignore"
      })
    );
  });

  it("rejects if the notifier process fails before spawning", async () => {
    const spawn = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = vi.fn();
      queueMicrotask(() => child.emit("error", new Error("boom")));
      return child;
    });
    const execFile = vi.fn();

    vi.doMock("node:child_process", () => ({ spawn, execFile }));

    const { notifyTask } = await import("../src/lib/notification.js");

    await expect(notifyTask(makeTask())).rejects.toThrow("boom");
  });

  it("uses osascript dialogs for waiting_input tasks", async () => {
    const spawn = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = vi.fn();
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });
    const execFile = vi.fn((_command: string, _args: string[], callback: Function) => {
      queueMicrotask(() => callback(null, { stdout: "false\n", stderr: "" }));
    });

    vi.doMock("node:child_process", () => ({ spawn, execFile }));

    const { notifyTask } = await import("../src/lib/notification.js");
    await notifyTask(
      makeTask({
        status: "waiting_input",
        name: "needs-reply",
        hostApp: "cursor",
        hostWindowRef: null,
        hostSessionRef: null
      })
    );

    expect(spawn).toHaveBeenNthCalledWith(
      1,
      "/usr/bin/afplay",
      ["/System/Library/Sounds/Glass.aiff"],
      expect.objectContaining({
        detached: true,
        stdio: "ignore"
      })
    );
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      "osascript",
      expect.any(Array),
      expect.objectContaining({
        detached: true,
        stdio: "ignore"
      })
    );
    const osascriptArgs = spawn.mock.calls[1]?.[1];
    const script = osascriptArgs?.[1];
    expect(osascriptArgs?.[0]).toBe("-e");
    expect(script).not.toContain("beep 1");
    expect(script).toContain("任务“needs-reply”正在等待你输入。");
    expect(script).toContain("Monitor 等待输入");
    expect(script).toContain('buttons {"忽略", "打开任务"}');
    expect(script).toContain('if button returned of dialogResult is "打开任务" then');
    expect(script).toContain('tell application "Cursor"');
  });

  it("still shows the dialog if the waiting sound fails", async () => {
    let spawnCall = 0;
    const spawn = vi.fn(() => {
      spawnCall += 1;
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = vi.fn();
      queueMicrotask(() => {
        if (spawnCall === 1) {
          child.emit("error", new Error("afplay failed"));
          return;
        }

        child.emit("spawn");
      });
      return child;
    });
    const execFile = vi.fn((_command: string, _args: string[], callback: Function) => {
      queueMicrotask(() => callback(null, { stdout: "false\n", stderr: "" }));
    });

    vi.doMock("node:child_process", () => ({ spawn, execFile }));

    const { notifyTask } = await import("../src/lib/notification.js");
    await notifyTask(
      makeTask({
        status: "waiting_approval",
        name: "needs-approval"
      })
    );

    expect(spawn).toHaveBeenNthCalledWith(
      1,
      "/usr/bin/afplay",
      ["/System/Library/Sounds/Glass.aiff"],
      expect.objectContaining({
        detached: true,
        stdio: "ignore"
      })
    );
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      "osascript",
      expect.any(Array),
      expect.objectContaining({
        detached: true,
        stdio: "ignore"
      })
    );
    const osascriptArgs = spawn.mock.calls[1]?.[1];
    const script = osascriptArgs?.[1];
    expect(osascriptArgs?.[0]).toBe("-e");
    expect(script).toContain("任务“needs-approval”正在等待你审批。");
    expect(script).toContain("Monitor 等待审批");
  });

  it("plays the sound without showing a dialog when the task is already visible in front", async () => {
    const spawn = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = vi.fn();
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });
    const execFile = vi.fn((_command: string, _args: string[], callback: Function) => {
      queueMicrotask(() => callback(null, { stdout: "true\n", stderr: "" }));
    });

    vi.doMock("node:child_process", () => ({ spawn, execFile }));

    const { notifyTask } = await import("../src/lib/notification.js");
    await notifyTask(
      makeTask({
        status: "waiting_input",
        name: "needs-reply",
        hostApp: "cursor",
        hostWindowRef:
          'cursor-window:{"title":"Cursor A — project-a","document":"file:///tmp/project-a/README.md","workspace":"project-a","x":10,"y":38,"width":1440,"height":900}',
        hostSessionRef: null
      })
    );

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenNthCalledWith(
      1,
      "/usr/bin/afplay",
      ["/System/Library/Sounds/Glass.aiff"],
      expect.objectContaining({
        detached: true,
        stdio: "ignore"
      })
    );
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile).toHaveBeenCalledWith(
      "osascript",
      expect.any(Array),
      expect.any(Function)
    );
  });

  it("suppresses the dialog for Terminal tasks when the selected front tab tty matches", async () => {
    const spawn = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = vi.fn();
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });
    const execFile = vi.fn((_command: string, _args: string[], callback: Function) => {
      queueMicrotask(() => callback(null, { stdout: "true\n", stderr: "" }));
    });

    vi.doMock("node:child_process", () => ({ spawn, execFile }));

    const { notifyTask } = await import("../src/lib/notification.js");
    await notifyTask(
      makeTask({
        status: "waiting_input",
        name: "needs-reply",
        hostApp: "terminal",
        hostWindowRef: "2E190177-7CD9-4678-8E24-13D260954522",
        hostSessionRef: "/dev/ttys013"
      })
    );

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenNthCalledWith(
      1,
      "/usr/bin/afplay",
      ["/System/Library/Sounds/Glass.aiff"],
      expect.objectContaining({
        detached: true,
        stdio: "ignore"
      })
    );
    expect(execFile).toHaveBeenCalledTimes(1);
    const args = execFile.mock.calls[0]?.[1];
    expect(args).toContain('tell application "Terminal"');
    expect(args).toContain(
      'return (tty of selected tab of front window as text) is "/dev/ttys013"'
    );
  });

  it("still shows the dialog for Terminal tasks when Terminal is not the frontmost app", async () => {
    const spawn = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = vi.fn();
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });
    const execFile = mockExecFileWithFrontmostGate("Terminal");

    vi.doMock("node:child_process", () => ({ spawn, execFile }));

    const { notifyTask } = await import("../src/lib/notification.js");
    await notifyTask(
      makeTask({
        status: "waiting_input",
        name: "needs-reply",
        hostApp: "terminal",
        hostWindowRef: "2E190177-7CD9-4678-8E24-13D260954522",
        hostSessionRef: "/dev/ttys013"
      })
    );

    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile.mock.calls[0]?.[1].join("\n")).toContain(
      'frontmost of process "Terminal"'
    );
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      "osascript",
      expect.any(Array),
      expect.objectContaining({
        detached: true,
        stdio: "ignore"
      })
    );
  });

  it("still shows the dialog for iTerm2 tasks when iTerm2 is not the frontmost app", async () => {
    const spawn = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = vi.fn();
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });
    const execFile = mockExecFileWithFrontmostGate("iTerm2");

    vi.doMock("node:child_process", () => ({ spawn, execFile }));

    const { notifyTask } = await import("../src/lib/notification.js");
    await notifyTask(
      makeTask({
        status: "waiting_input",
        name: "needs-reply",
        hostApp: "iterm2",
        hostWindowRef: "window-2",
        hostSessionRef: "/dev/ttys021"
      })
    );

    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile.mock.calls[0]?.[1].join("\n")).toContain(
      'frontmost of process "iTerm2"'
    );
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      "osascript",
      expect.any(Array),
      expect.objectContaining({
        detached: true,
        stdio: "ignore"
      })
    );
  });

  it("still shows the dialog for Cursor tasks when Cursor is not the frontmost app", async () => {
    const spawn = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = vi.fn();
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });
    const execFile = mockExecFileWithFrontmostGate("Cursor");

    vi.doMock("node:child_process", () => ({ spawn, execFile }));

    const { notifyTask } = await import("../src/lib/notification.js");
    await notifyTask(
      makeTask({
        status: "waiting_input",
        name: "needs-reply",
        hostApp: "cursor",
        hostWindowRef:
          'cursor-window:{"title":"Cursor A — project-a","document":"file:///tmp/project-a/README.md","workspace":"project-a","x":10,"y":38,"width":1440,"height":900}',
        hostSessionRef: null
      })
    );

    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile.mock.calls[0]?.[1].join("\n")).toContain(
      'frontmost of process "Cursor"'
    );
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      "osascript",
      expect.any(Array),
      expect.objectContaining({
        detached: true,
        stdio: "ignore"
      })
    );
  });
});
