const { execFile } = require("node:child_process");
const { appendFileSync, mkdirSync } = require("node:fs");
const { homedir } = require("node:os");
const { join } = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const CURSOR_DEBUG_LOG_FILE = "cursor-focus-debug.jsonl";

function quoteAppleScriptString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function appendCursorDebugLog(event, payload = {}) {
  try {
    const dataDir = process.env.MONITOR_DATA_DIR ?? join(homedir(), ".monitor-data");
    mkdirSync(dataDir, { recursive: true });
    appendFileSync(
      join(dataDir, CURSOR_DEBUG_LOG_FILE),
      `${JSON.stringify({
        ts: new Date().toISOString(),
        scope: "cursor-window-focus",
        pid: process.pid,
        event,
        ...payload
      })}\n`,
      "utf8"
    );
  } catch {
    // Debug logging is best-effort only.
  }
}

function parseOptionalInteger(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = String(value).trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return null;
  }

  return Number(trimmed);
}

function parseRaiseCursorWindowResult(stdout) {
  const lines = String(stdout ?? "").trimEnd().split(/\r?\n/);
  const [status = "", bestScore, matchedWindowNumber, matchedIdentifier, matchedTitle, matchedDocument, matchedPosition, matchedSize] =
    lines;

  return {
    status,
    raised: status === "raised",
    bestScore: parseOptionalInteger(bestScore),
    matchedWindowNumber: parseOptionalInteger(matchedWindowNumber),
    matchedIdentifier: matchedIdentifier || null,
    matchedTitle: matchedTitle || null,
    matchedDocument: matchedDocument || null,
    matchedPosition: matchedPosition || null,
    matchedSize: matchedSize || null,
    raw: String(stdout ?? "").trim()
  };
}

function buildActivateCursorAppScript() {
  return `
tell application "Cursor"
  activate
end tell
`.trim();
}

function parseCursorWindowRef(windowRef) {
  if (typeof windowRef !== "string" || !windowRef.startsWith("cursor-window:")) {
    return null;
  }

  try {
    return JSON.parse(windowRef.slice("cursor-window:".length));
  } catch {
    return null;
  }
}

function buildRaiseCursorWindowScript(windowRef) {
  const snapshot = parseCursorWindowRef(windowRef);
  if (!snapshot) {
    return null;
  }

  return `
tell application "Cursor"
  activate
end tell

tell application "System Events"
  if not (exists process "Cursor") then return "missing-process" & linefeed & "-1" & linefeed & "-1" & linefeed & "" & linefeed & "" & linefeed & "" & linefeed & "-1,-1" & linefeed & "-1,-1"

  tell process "Cursor"
    set targetTitle to ${quoteAppleScriptString(snapshot.title ?? "")}
    set targetDocument to ${quoteAppleScriptString(snapshot.document ?? "")}
    set targetWorkspace to ${quoteAppleScriptString(snapshot.workspace ?? "")}
    set targetPosition to {${String(snapshot.x ?? -1)}, ${String(snapshot.y ?? -1)}}
    set targetSize to {${String(snapshot.width ?? -1)}, ${String(snapshot.height ?? -1)}}
    set targetWindowNumber to ${String(snapshot.windowNumber ?? -1)}
    set targetIdentifier to ${quoteAppleScriptString(snapshot.identifier ?? "")}
    set matchedWindow to missing value
    set bestScore to -1
    set matchedWindowNumberValue to -1
    set matchedIdentifierValue to ""
    set matchedTitleValue to ""
    set matchedDocumentValue to ""
    set matchedPositionValue to {-1, -1}
    set matchedSizeValue to {-1, -1}

    repeat with aWindow in windows
      set candidateScore to 0
      set candidateName to ""

      try
        set candidateName to name of aWindow as text
      on error
        set candidateName to ""
      end try

      try
        set candidateWindowNumber to value of attribute "AXWindowNumber" of aWindow
      on error
        set candidateWindowNumber to -1
      end try

      try
        set candidateIdentifier to value of attribute "AXIdentifier" of aWindow as text
      on error
        set candidateIdentifier to ""
      end try

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

      if targetWindowNumber is not -1 and candidateWindowNumber is targetWindowNumber then
        set candidateScore to candidateScore + 2000
      end if

      if targetWorkspace is not "" and candidateName is targetWorkspace then
        set candidateScore to candidateScore + 3200
      end if

      if targetTitle is not "" and candidateName is targetTitle then
        set candidateScore to candidateScore + 1500
      end if

      if targetIdentifier is not "" and candidateIdentifier is targetIdentifier then
        set candidateScore to candidateScore + 1200
      end if

      if targetDocument is not "" and candidateDocument is targetDocument then
        set candidateScore to candidateScore + 900
      end if

      if targetWorkspace is not "" and candidateDocument contains ("/" & targetWorkspace & "/") then
        set candidateScore to candidateScore + 260
      end if

      if targetTitle is not "" and candidateTitle is targetTitle then
        set candidateScore to candidateScore + 80
      end if

      if targetWorkspace is not "" and candidateTitle ends with ("— " & targetWorkspace) then
        set candidateScore to candidateScore + 120
      else if targetWorkspace is not "" and candidateTitle contains targetWorkspace then
        set candidateScore to candidateScore + 40
      end if

      if targetPosition is not {-1, -1} and candidatePosition is targetPosition then
        set candidateScore to candidateScore + 40
      end if

      if targetSize is not {-1, -1} and candidateSize is targetSize then
        set candidateScore to candidateScore + 40
      end if

      if candidateScore > bestScore then
        set bestScore to candidateScore
        set matchedWindow to aWindow
        set matchedWindowNumberValue to candidateWindowNumber
        set matchedIdentifierValue to candidateIdentifier
        set matchedTitleValue to candidateTitle
        set matchedDocumentValue to candidateDocument
        set matchedPositionValue to candidatePosition
        set matchedSizeValue to candidateSize
      end if
    end repeat

    if matchedWindow is missing value or bestScore < 200 then
      return "missing-window" & linefeed & (bestScore as text) & linefeed & (matchedWindowNumberValue as text) & linefeed & matchedIdentifierValue & linefeed & matchedTitleValue & linefeed & matchedDocumentValue & linefeed & (item 1 of matchedPositionValue as text) & "," & (item 2 of matchedPositionValue as text) & linefeed & (item 1 of matchedSizeValue as text) & "," & (item 2 of matchedSizeValue as text)
    end if

    try
      perform action "AXRaise" of matchedWindow
    end try

    try
      set value of attribute "AXMain" of matchedWindow to true
    end try

    try
      set value of attribute "AXFrontmost" of matchedWindow to true
    end try

    return "raised" & linefeed & (bestScore as text) & linefeed & (matchedWindowNumberValue as text) & linefeed & matchedIdentifierValue & linefeed & matchedTitleValue & linefeed & matchedDocumentValue & linefeed & (item 1 of matchedPositionValue as text) & "," & (item 2 of matchedPositionValue as text) & linefeed & (item 1 of matchedSizeValue as text) & "," & (item 2 of matchedSizeValue as text)
  end tell
end tell
`.trim();
}

async function raiseCursorWindow(windowRef, execFileImpl = execFileAsync) {
  const script = buildRaiseCursorWindowScript(windowRef);
  if (!script) {
    appendCursorDebugLog("raise-skipped", {
      reason: "invalid-window-ref",
      windowRef
    });
    return false;
  }

  try {
    const result = await execFileImpl("osascript", ["-e", script]);
    const stdout = typeof result === "string" ? result : result.stdout;
    const detail = parseRaiseCursorWindowResult(stdout);
    appendCursorDebugLog("raise-result", {
      targetWindowRef: windowRef,
      targetSnapshot: parseCursorWindowRef(windowRef),
      ...detail
    });
    return detail.raised;
  } catch (error) {
    appendCursorDebugLog("raise-error", {
      targetWindowRef: windowRef,
      targetSnapshot: parseCursorWindowRef(windowRef),
      error: String(error)
    });
    return false;
  }
}

async function activateCursorApp(execFileImpl = execFileAsync) {
  try {
    await execFileImpl("osascript", ["-e", buildActivateCursorAppScript()]);
    appendCursorDebugLog("activate-app-result", {
      activated: true
    });
    return true;
  } catch (error) {
    appendCursorDebugLog("activate-app-error", {
      activated: false,
      error: String(error)
    });
    return false;
  }
}

module.exports = {
  activateCursorApp,
  buildActivateCursorAppScript,
  buildRaiseCursorWindowScript,
  parseRaiseCursorWindowResult,
  parseCursorWindowRef,
  raiseCursorWindow
};
