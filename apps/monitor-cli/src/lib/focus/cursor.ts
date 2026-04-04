import { buildCursorBridgeUri } from "./cursor-bridge.js";

function quoteAppleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

interface CursorWindowSnapshot {
  title: string | null;
  document: string | null;
  workspace: string | null;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
}

function parseCursorWindowRef(windowRef: string | null): CursorWindowSnapshot | null {
  if (!windowRef?.startsWith("cursor-window:")) {
    return null;
  }

  try {
    return JSON.parse(windowRef.slice("cursor-window:".length)) as CursorWindowSnapshot;
  } catch {
    return null;
  }
}

export function cursorScript(
  windowRef: string | null = null,
  cwd: string | null = null,
  taskId: string | null = null
): string {
  const snapshot = parseCursorWindowRef(windowRef);
  const openWorkspaceScript = cwd
    ? `
set targetCwd to ${quoteAppleScriptString(cwd)}
do shell script "/usr/bin/open -a Cursor " & quoted form of targetCwd
delay 0.5
`
    : "";
  const focusTerminalScript = taskId
    ? `
delay 0.1
try
  open location ${quoteAppleScriptString(
    buildCursorBridgeUri("focus", {
      taskId
    })
  )}
end try
`
    : "";
  const windowSelector = snapshot
    ? `
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

      if targetTitle is not "" and candidateTitle is targetTitle then
        set matchedWindow to aWindow
        exit repeat
      end if

      if targetWorkspace is not "" and candidateTitle ends with ("— " & targetWorkspace) then
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
    end if`
    : windowRef
    ? `
    try
      perform action "AXRaise" of window ${quoteAppleScriptString(windowRef)}
    end try

    try
      set value of attribute "AXMain" of window ${quoteAppleScriptString(windowRef)} to true
    end try

    try
      set value of attribute "AXFrontmost" of window ${quoteAppleScriptString(windowRef)} to true
    end try`
    : "";

  return `
${openWorkspaceScript}
tell application "Cursor"
  activate
end tell

tell application "System Events"
  tell process "Cursor"
${windowSelector}
  end tell
end tell
${focusTerminalScript}
`.trim();
}
