const { parseCursorWindowRef } = require("./window-focus");

const CURSOR_BRIDGE_EXTENSION_ID = "liangxin.monitor-cursor-bridge";

function buildCursorBridgeUri(action, params = {}) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    searchParams.set(key, String(value));
  }

  const query = searchParams.toString();
  return `cursor://${CURSOR_BRIDGE_EXTENSION_ID}/${action}${query ? `?${query}` : ""}`;
}

function extractWorkspaceFromWindowRef(windowRef) {
  return parseCursorWindowRef(windowRef)?.workspace ?? null;
}

function shouldRouteFocusRequest(parsed, currentWorkspaceName) {
  if (parsed?.action !== "focus") {
    return false;
  }

  if ((parsed.focusAttempt ?? 0) >= 1) {
    return false;
  }

  const targetWorkspaceName = extractWorkspaceFromWindowRef(parsed.windowRef);
  if (!targetWorkspaceName) {
    return false;
  }

  return !currentWorkspaceName || currentWorkspaceName !== targetWorkspaceName;
}

function buildWorkspaceRouteFocusUri(parsed) {
  if (!parsed?.taskId) {
    return null;
  }

  return buildCursorBridgeUri("focus", {
    taskId: parsed.taskId,
    cwd: parsed.cwd,
    monitorPid: parsed.monitorPid,
    windowRef: parsed.windowRef,
    focusAttempt: (parsed.focusAttempt ?? 0) + 1
  });
}

module.exports = {
  buildCursorBridgeUri,
  buildWorkspaceRouteFocusUri,
  extractWorkspaceFromWindowRef,
  shouldRouteFocusRequest
};
