const test = require("node:test");
const assert = require("node:assert/strict");
const {
  forgetTerminal,
  resolveTerminal,
  resolveTerminalByCwd,
  resolveTerminalByProcessId,
  resolveTerminalByMonitorPid
} = require("../lib/registry");

test("resolveTerminal returns the mapped terminal when still open", () => {
  const terminal = { name: "Terminal 1" };
  const registry = new Map([["task-1", terminal]]);

  assert.equal(resolveTerminal(registry, "task-1", [terminal]), terminal);
});

test("forgetTerminal removes all mappings for a closed terminal", () => {
  const terminal = { name: "Terminal 1" };
  const registry = new Map([
    ["task-1", terminal],
    ["task-2", terminal]
  ]);

  forgetTerminal(registry, terminal);

  assert.equal(registry.size, 0);
});

test("resolveTerminal falls back to cwd when mapping is missing", () => {
  const terminal = {
    name: "Terminal 2",
    shellIntegration: {
      cwd: {
        fsPath: "/tmp/project"
      }
    }
  };

  assert.equal(resolveTerminal(new Map(), "task-1", [terminal], "/tmp/project"), terminal);
});

test("resolveTerminalByCwd returns null when multiple terminals share the same cwd", () => {
  const terminals = [
    {
      name: "Terminal 1",
      shellIntegration: {
        cwd: {
          fsPath: "/tmp/project"
        }
      }
    },
    {
      name: "Terminal 2",
      shellIntegration: {
        cwd: {
          fsPath: "/tmp/project"
        }
      }
    }
  ];

  assert.equal(resolveTerminalByCwd(terminals, "/tmp/project"), null);
});

test("resolveTerminalByProcessId matches a persisted terminal shell pid", async () => {
  const terminal = {
    name: "Terminal 5",
    processId: Promise.resolve(456)
  };
  const otherTerminal = {
    name: "Terminal 6",
    processId: Promise.resolve(789)
  };

  const resolved = await resolveTerminalByProcessId([otherTerminal, terminal], 456);

  assert.equal(resolved, terminal);
});

test("resolveTerminalByMonitorPid matches the terminal shell pid from the monitor ancestor chain", async () => {
  const terminal = {
    name: "Terminal 3",
    processId: Promise.resolve(300)
  };
  const otherTerminal = {
    name: "Terminal 4",
    processId: Promise.resolve(999)
  };
  const execFileMock = async (_command, args) => {
    const pid = args.at(-1);
    if (pid === "4321") {
      return { stdout: "400\n" };
    }
    if (pid === "400") {
      return { stdout: "300\n" };
    }
    if (pid === "300") {
      return { stdout: "1\n" };
    }

    return { stdout: "0\n" };
  };

  const resolved = await resolveTerminalByMonitorPid(
    [otherTerminal, terminal],
    "4321",
    execFileMock
  );

  assert.equal(resolved, terminal);
});
