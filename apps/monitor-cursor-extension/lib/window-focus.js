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
    end repeat

    if matchedWindow is missing value then return "missing-window"

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
