const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildCursorBridgeUri,
  buildWorkspaceRouteFocusUri,
  extractWorkspaceFromWindowRef,
  shouldRouteFocusRequest
} = require("../lib/workspace-routing");

test("extractWorkspaceFromWindowRef returns the snapshot workspace", () => {
  assert.equal(
    extractWorkspaceFromWindowRef(
      'cursor-window:{"title":"test3","document":null,"workspace":"test3","x":0,"y":30,"width":2560,"height":1308}'
    ),
    "test3"
  );
});

test("shouldRouteFocusRequest only reroutes the first cross-workspace focus attempt", () => {
  const parsed = {
    action: "focus",
    taskId: "task-1",
    cwd: "/tmp/test3",
    monitorPid: "1234",
    windowRef:
      'cursor-window:{"title":"test3","document":null,"workspace":"test3","x":0,"y":30,"width":2560,"height":1308}',
    focusAttempt: 0
  };

  assert.equal(shouldRouteFocusRequest(parsed, "111"), true);
  assert.equal(shouldRouteFocusRequest(parsed, "test3"), false);
  assert.equal(
    shouldRouteFocusRequest(
      {
        ...parsed,
        focusAttempt: 1
      },
      "111"
    ),
    false
  );
});

test("buildWorkspaceRouteFocusUri increments focusAttempt and preserves focus params", () => {
  const parsed = {
    action: "focus",
    taskId: "task-1",
    cwd: "/tmp/test3",
    monitorPid: "1234",
    windowRef:
      'cursor-window:{"title":"test3","document":null,"workspace":"test3","x":0,"y":30,"width":2560,"height":1308}',
    focusAttempt: 0
  };

  assert.equal(
    buildWorkspaceRouteFocusUri(parsed),
    buildCursorBridgeUri("focus", {
      taskId: "task-1",
      cwd: "/tmp/test3",
      monitorPid: "1234",
      windowRef:
        'cursor-window:{"title":"test3","document":null,"workspace":"test3","x":0,"y":30,"width":2560,"height":1308}',
      focusAttempt: 1
    })
  );
});
