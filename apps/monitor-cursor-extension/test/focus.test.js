const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_FOCUS_REROUTE_ATTEMPTS,
  buildFocusRerouteScript,
  buildFocusRerouteUri,
  shouldRerouteFocus
} = require("../lib/focus");

const windowRef =
  'cursor-window:{"title":"test","document":null,"workspace":"test","x":0,"y":30,"width":2560,"height":1307}';

test("shouldRerouteFocus only reroutes cursor window tasks within retry budget", () => {
  assert.equal(
    shouldRerouteFocus({
      taskId: "47409688-b338-4b17-b35d-247a8a363efd",
      windowRef,
      focusAttempt: 0
    }),
    true
  );

  assert.equal(
    shouldRerouteFocus({
      taskId: "47409688-b338-4b17-b35d-247a8a363efd",
      windowRef,
      focusAttempt: MAX_FOCUS_REROUTE_ATTEMPTS
    }),
    false
  );
});

test("buildFocusRerouteUri preserves focus context and increments the retry count", () => {
  const uri = buildFocusRerouteUri({
    taskId: "47409688-b338-4b17-b35d-247a8a363efd",
    cwd: "/Users/sean/Desktop/test",
    monitorPid: "5829",
    windowRef,
    focusAttempt: 0
  });

  assert.equal(
    uri,
    "cursor://liangxin.monitor-cursor-bridge/focus?taskId=47409688-b338-4b17-b35d-247a8a363efd&cwd=%2FUsers%2Fsean%2FDesktop%2Ftest&monitorPid=5829&windowRef=cursor-window%3A%7B%22title%22%3A%22test%22%2C%22document%22%3Anull%2C%22workspace%22%3A%22test%22%2C%22x%22%3A0%2C%22y%22%3A30%2C%22width%22%3A2560%2C%22height%22%3A1307%7D&focusAttempt=1"
  );
});

test("buildFocusRerouteScript raises the target window and reopens the focus URI", () => {
  const script = buildFocusRerouteScript({
    taskId: "47409688-b338-4b17-b35d-247a8a363efd",
    cwd: "/Users/sean/Desktop/test",
    monitorPid: "5829",
    windowRef,
    focusAttempt: 0
  });

  assert.match(script, /set targetTitle to "test"/);
  assert.match(script, /set targetPosition to \{0, 30\}/);
  assert.match(script, /set targetSize to \{2560, 1307\}/);
  assert.match(script, /delay 0\.2/);
  assert.match(script, /focusAttempt=1/);
});
