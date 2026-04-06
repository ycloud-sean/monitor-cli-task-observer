const test = require("node:test");
const assert = require("node:assert/strict");
const {
  activateCursorApp,
  buildActivateCursorAppScript,
  buildRaiseCursorWindowScript,
  parseRaiseCursorWindowResult,
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
  assert.match(script, /set matchedWindowNumberValue to -1/);
  assert.match(script, /set candidateName to ""/);
  assert.match(script, /name of aWindow as text/);
  assert.match(script, /candidateName is targetWorkspace/);
  assert.match(script, /candidateTitle contains targetWorkspace/);
  assert.match(script, /bestScore < 200/);
  assert.match(script, /perform action "AXRaise"/);
  assert.match(script, /return "raised" & linefeed/);
});

test("parseRaiseCursorWindowResult understands detailed osascript output", () => {
  const result = parseRaiseCursorWindowResult(
    [
      "raised",
      "2200",
      "71",
      "window-71",
      "Cursor A — project-a",
      "file:///tmp/project-a/README.md",
      "10,38",
      "1440,900"
    ].join("\n")
  );

  assert.deepEqual(result, {
    status: "raised",
    raised: true,
    bestScore: 2200,
    matchedWindowNumber: 71,
    matchedIdentifier: "window-71",
    matchedTitle: "Cursor A — project-a",
    matchedDocument: "file:///tmp/project-a/README.md",
    matchedPosition: "10,38",
    matchedSize: "1440,900",
    raw: [
      "raised",
      "2200",
      "71",
      "window-71",
      "Cursor A — project-a",
      "file:///tmp/project-a/README.md",
      "10,38",
      "1440,900"
    ].join("\n")
  });
});

test("buildActivateCursorAppScript activates Cursor without window matching", () => {
  const script = buildActivateCursorAppScript();
  assert.match(script, /tell application "Cursor"/);
  assert.match(script, /activate/);
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

test("activateCursorApp invokes osascript and returns true when activation succeeds", async () => {
  const calls = [];
  const activated = await activateCursorApp(async (command, args) => {
    calls.push({ command, args });
    return { stdout: "" };
  });

  assert.equal(activated, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "osascript");
  assert.deepEqual(calls[0].args, ["-e", buildActivateCursorAppScript()]);
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

  const activationFailed = await activateCursorApp(async () => {
    throw new Error("osascript failed");
  });
  assert.equal(activationFailed, false);
});
