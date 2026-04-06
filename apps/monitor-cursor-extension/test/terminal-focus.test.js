const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getTerminalFocusIndexCommand,
  revealTerminal
} = require("../lib/terminal-focus");

test("getTerminalFocusIndexCommand returns the matching command for terminals 1-9", () => {
  const terminals = Array.from({ length: 3 }, (_, index) => ({ name: `Terminal ${index + 1}` }));

  assert.equal(
    getTerminalFocusIndexCommand(terminals, terminals[0]),
    "workbench.action.terminal.focusAtIndex1"
  );
  assert.equal(
    getTerminalFocusIndexCommand(terminals, terminals[2]),
    "workbench.action.terminal.focusAtIndex3"
  );
});

test("getTerminalFocusIndexCommand returns null when terminal is missing or index exceeds 9", () => {
  const tenTerminals = Array.from({ length: 10 }, (_, index) => ({ name: `Terminal ${index + 1}` }));

  assert.equal(getTerminalFocusIndexCommand(tenTerminals, { name: "other" }), null);
  assert.equal(getTerminalFocusIndexCommand(tenTerminals, tenTerminals[9]), null);
});

test("revealTerminal shows the terminal, selects it by index, and focuses terminal UI", async () => {
  const calls = [];
  const terminal = {
    show(preserveFocus) {
      calls.push(["show", preserveFocus]);
    }
  };

  const result = await revealTerminal(
    terminal,
    [terminal],
    async (command) => {
      calls.push(["command", command]);
    },
    () => terminal
  );

  assert.deepEqual(result, {
    focusIndexCommand: "workbench.action.terminal.focusAtIndex1"
  });
  assert.deepEqual(calls, [
    ["show", false],
    ["command", "workbench.action.terminal.focusAtIndex1"],
    ["command", "workbench.action.terminal.focus"]
  ]);
});

test("revealTerminal retries show when activeTerminal is still different", async () => {
  const calls = [];
  const terminal = {
    show(preserveFocus) {
      calls.push(["show", preserveFocus]);
    }
  };
  const otherTerminal = { name: "other" };

  await revealTerminal(
    terminal,
    [otherTerminal, terminal],
    async (command) => {
      calls.push(["command", command]);
    },
    () => otherTerminal
  );

  assert.deepEqual(calls, [
    ["show", false],
    ["command", "workbench.action.terminal.focusAtIndex2"],
    ["show", false],
    ["command", "workbench.action.terminal.focus"]
  ]);
});
