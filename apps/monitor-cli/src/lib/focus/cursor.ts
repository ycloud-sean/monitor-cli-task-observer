import { buildCursorBridgeUri } from "./cursor-bridge.js";
import { parseCursorWindowRef } from "./cursor-window.js";

function quoteAppleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function cursorScript(
  windowRef: string | null = null,
  cwd: string | null = null,
  taskId: string | null = null,
  processId: number | null = null
): string {
  const snapshot = parseCursorWindowRef(windowRef);
  const focusTerminalScript = taskId
    ? `
delay 0.1
try
  open location ${quoteAppleScriptString(
    buildCursorBridgeUri("focus", {
      taskId,
      cwd,
      monitorPid: processId ? String(processId) : null,
      windowRef
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
    set targetWindowNumber to ${String(snapshot.windowNumber ?? -1)}
    set targetIdentifier to ${quoteAppleScriptString(snapshot.identifier ?? "")}
    set matchedWindow to missing value
    set bestScore to -1

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
      end if
    end repeat

    if matchedWindow is not missing value and bestScore >= 200 then
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
