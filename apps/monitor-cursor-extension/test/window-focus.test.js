const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildRaiseCursorWindowScript,
  parseCursorWindowRef,
  raiseCursorWindow
} = require("../lib/window-focus");

test("parseCursorWindowRef returns null for invalid payloads", () => {
  assert.equal(parseCursorWindowRef(null), null);
  assert.equal(parseCursorWindowRef("window-1"), null);
  assert.equal(parseCursorWindowRef("cursor-window:not-json"), null);
});

test("buildRaiseCursorWindowScript includes Cursor window matching metadata", () => {
  const script = buildRaiseCursorWindowScript(
    'cursor-window:{"title":"test3","document":"file:///Users/sean/Desktop/test/test2/test3","workspace":"test3","x":1280,"y":30,"width":1280,"height":1307,"windowNumber":71,"identifier":"window-71"}'
  );

  assert.ok(script);
  assert.match(script, /tell application "Cursor"/);
  assert.match(script, /set targetTitle to "test3"/);
  assert.match(script, /set targetDocument to "file:\/\/\/Users\/sean\/Desktop\/test\/test2\/test3"/);
  assert.match(script, /set targetWorkspace to "test3"/);
  assert.match(script, /set targetPosition to \{1280, 30\}/);
  assert.match(script, /set targetSize to \{1280, 1307\}/);
  assert.match(script, /set targetWindowNumber to 71/);
  assert.match(script, /set targetIdentifier to "window-71"/);
  assert.match(script, /candidateTitle contains targetWorkspace/);
  assert.match(script, /bestScore < 200/);
  assert.match(script, /perform action "AXRaise"/);
});

test("raiseCursorWindow invokes osascript and returns true when the window is raised", async () => {
  const calls = [];
  const execFileMock = async (command, args) => {
    calls.push({ command, args });
    return { stdout: "raised\n" };
  };

  const raised = await raiseCursorWindow(
    'cursor-window:{"title":"111","document":null,"workspace":"111","x":0,"y":30,"width":1280,"height":1308}',
    execFileMock
  );

  assert.equal(raised, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "osascript");
  assert.deepEqual(calls[0].args.length, 2);
  assert.equal(calls[0].args[0], "-e");
  assert.match(calls[0].args[1], /set targetWorkspace to "111"/);
  assert.match(calls[0].args[1], /set bestScore to -1/);
});

test("raiseCursorWindow returns false when the window ref is invalid or osascript fails", async () => {
  const invalid = await raiseCursorWindow("window-1");
  assert.equal(invalid, false);

  const failed = await raiseCursorWindow(
    'cursor-window:{"title":"111","document":null,"workspace":"111","x":0,"y":30,"width":1280,"height":1308}',
    async () => {
      throw new Error("osascript failed");
    }
  );
  assert.equal(failed, false);
});
