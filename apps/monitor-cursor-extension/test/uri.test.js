const test = require("node:test");
const assert = require("node:assert/strict");
const { parseMonitorUri } = require("../lib/uri");

test("parseMonitorUri returns action and query parameters", () => {
  const parsed = parseMonitorUri({
    path: "/focus",
    query: "taskId=task-1&name=test&cwd=%2Ftmp%2Fproject"
  });

  assert.deepEqual(parsed, {
    action: "focus",
    taskId: "task-1",
    name: "test",
    cwd: "/tmp/project"
  });
});

test("parseMonitorUri ignores unsupported actions", () => {
  assert.equal(
    parseMonitorUri({
      path: "/unknown",
      query: "taskId=task-1"
    }),
    null
  );
});
