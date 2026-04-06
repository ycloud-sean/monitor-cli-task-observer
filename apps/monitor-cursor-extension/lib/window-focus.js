const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

function quoteAppleScriptString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
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
  if not (exists process "Cursor") then return "missing-process"

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

    repeat with aWindow in windows
      set candidateScore to 0

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
      end if
    end repeat

    if matchedWindow is missing value or bestScore < 200 then return "missing-window"

    try
      perform action "AXRaise" of matchedWindow
    end try

    try
      set value of attribute "AXMain" of matchedWindow to true
    end try

    try
      set value of attribute "AXFrontmost" of matchedWindow to true
    end try

    return "raised"
  end tell
end tell
`.trim();
}

async function raiseCursorWindow(windowRef, execFileImpl = execFileAsync) {
  const script = buildRaiseCursorWindowScript(windowRef);
  if (!script) {
    return false;
  }

  try {
    const result = await execFileImpl("osascript", ["-e", script]);
    const stdout = typeof result === "string" ? result : result.stdout;
    return String(stdout ?? "").trim() === "raised";
  } catch {
    return false;
  }
}

module.exports = {
  buildRaiseCursorWindowScript,
  parseCursorWindowRef,
  raiseCursorWindow
};
