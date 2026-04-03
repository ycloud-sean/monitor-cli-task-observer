function quoteAppleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function terminalScript(
  windowRef: string | null,
  sessionRef: string | null
): string {
  const windowSelector =
    windowRef && /^\d+$/.test(windowRef)
      ? `
  try
    set targetWindow to first window whose id is ${windowRef}
  on error
    set targetWindow to missing value
  end try`
      : `
  set targetWindow to missing value`;
  const sessionSelector = sessionRef
    ? `
  if targetWindow is not missing value then
    repeat with aTab in tabs of targetWindow
      if tty of aTab is ${quoteAppleScriptString(sessionRef)} then
        set selected tab of targetWindow to aTab
        set frontmost of targetWindow to true
        return
      end if
    end repeat
  end if

  repeat with aWindow in windows
    repeat with aTab in tabs of aWindow
      if tty of aTab is ${quoteAppleScriptString(sessionRef)} then
        set selected tab of aWindow to aTab
        set frontmost of aWindow to true
        return
      end if
    end repeat
  end repeat`
    : "";

  return `
tell application "Terminal"
  activate
${windowSelector}
${sessionSelector}
  try
    set frontmost of front window to true
  end try
end tell
`.trim();
}

export function iTermScript(
  _windowRef: string | null,
  sessionRef: string | null
): string {
  const sessionSelector = sessionRef
    ? `
  repeat with aWindow in windows
    repeat with aTab in tabs of aWindow
      repeat with aSession in sessions of aTab
        if tty of aSession is ${quoteAppleScriptString(sessionRef)} then
          tell aTab to select
          tell aSession to select
          return
        end if
      end repeat
    end repeat
  end repeat`
    : "";

  return `
tell application "iTerm2"
  activate
${sessionSelector}
end tell
`.trim();
}
