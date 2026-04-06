const CURSOR_BRIDGE_EXTENSION_ID = "liangxin.monitor-cursor-bridge";
const CURSOR_WINDOW_REF_PREFIX = "cursor-window:";
const MAX_FOCUS_REROUTE_ATTEMPTS = 2;

function quoteAppleScriptString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function parseCursorWindowRef(windowRef) {
  if (typeof windowRef !== "string" || !windowRef.startsWith(CURSOR_WINDOW_REF_PREFIX)) {
    return null;
  }

  try {
    const parsed = JSON.parse(windowRef.slice(CURSOR_WINDOW_REF_PREFIX.length));
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return {
      title: typeof parsed.title === "string" ? parsed.title : null,
      document: typeof parsed.document === "string" ? parsed.document : null,
      workspace: typeof parsed.workspace === "string" ? parsed.workspace : null,
      x: Number.isFinite(parsed.x) ? parsed.x : null,
      y: Number.isFinite(parsed.y) ? parsed.y : null,
      width: Number.isFinite(parsed.width) ? parsed.width : null,
      height: Number.isFinite(parsed.height) ? parsed.height : null
    };
  } catch {
    return null;
  }
}

function buildCursorBridgeFocusUri(params) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    searchParams.set(key, String(value));
  }

  const query = searchParams.toString();
  return `cursor://${CURSOR_BRIDGE_EXTENSION_ID}/focus${query ? `?${query}` : ""}`;
}

function shouldRerouteFocus(parsed) {
  return Boolean(
    parsed?.taskId &&
      parsed?.windowRef &&
      parseCursorWindowRef(parsed.windowRef) &&
      (parsed.focusAttempt ?? 0) < MAX_FOCUS_REROUTE_ATTEMPTS
  );
}

function buildFocusRerouteUri(parsed) {
  return buildCursorBridgeFocusUri({
    taskId: parsed?.taskId ?? null,
    name: parsed?.name ?? null,
    cwd: parsed?.cwd ?? null,
    monitorPid: parsed?.monitorPid ?? null,
    windowRef: parsed?.windowRef ?? null,
    focusAttempt: String((parsed?.focusAttempt ?? 0) + 1)
  });
}

function buildFocusRerouteScript(parsed) {
  const snapshot = parseCursorWindowRef(parsed?.windowRef ?? null);
  if (!snapshot) {
    return null;
  }

  const rerouteUri = buildFocusRerouteUri(parsed);
  return `
tell application "Cursor"
  activate
end tell

tell application "System Events"
  tell process "Cursor"
    set targetTitle to ${quoteAppleScriptString(snapshot.title ?? "")}
    set targetDocument to ${quoteAppleScriptString(snapshot.document ?? "")}
    set targetWorkspace to ${quoteAppleScriptString(snapshot.workspace ?? "")}
    set targetPosition to {${String(snapshot.x ?? -1)}, ${String(snapshot.y ?? -1)}}
    set targetSize to {${String(snapshot.width ?? -1)}, ${String(snapshot.height ?? -1)}}
    set matchedWindow to missing value

    repeat with aWindow in windows
      try
        set candidateDocument to value of attribute "AXDocument" of aWindow as text
      on error
        set candidateDocument to ""
      end try

      try
        set candidateTitle to value of attribute "AXTitle" of aWindow as text
      on error
        set candidateTitle to ""
      end try

      try
        set candidatePosition to value of attribute "AXPosition" of aWindow
      on error
        set candidatePosition to {-1, -1}
      end try

      try
        set candidateSize to value of attribute "AXSize" of aWindow
      on error
        set candidateSize to {-1, -1}
      end try

      if targetDocument is not "" and candidateDocument is targetDocument then
        set matchedWindow to aWindow
        exit repeat
      end if

      if targetTitle is not "" and candidateTitle is targetTitle and candidatePosition is targetPosition and candidateSize is targetSize then
        set matchedWindow to aWindow
        exit repeat
      end if

      if targetWorkspace is not "" and candidateTitle ends with ("— " & targetWorkspace) and candidatePosition is targetPosition and candidateSize is targetSize then
        set matchedWindow to aWindow
        exit repeat
      end if

      if candidatePosition is targetPosition and candidateSize is targetSize then
        set matchedWindow to aWindow
        exit repeat
      end if
    end repeat

    if matchedWindow is not missing value then
      try
        perform action "AXRaise" of matchedWindow
      end try

      try
        set value of attribute "AXMain" of matchedWindow to true
      end try

      try
        set value of attribute "AXFrontmost" of matchedWindow to true
      end try
    end if
  end tell
end tell

delay 0.2

try
  open location ${quoteAppleScriptString(rerouteUri)}
end try
`.trim();
}

module.exports = {
  MAX_FOCUS_REROUTE_ATTEMPTS,
  buildCursorBridgeFocusUri,
  buildFocusRerouteScript,
  buildFocusRerouteUri,
  parseCursorWindowRef,
  shouldRerouteFocus
};
