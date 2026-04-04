const test = require("node:test");
const assert = require("node:assert/strict");
const { forgetTerminal, resolveTerminal } = require("../lib/registry");

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
