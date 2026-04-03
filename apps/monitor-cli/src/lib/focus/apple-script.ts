export function terminalScript(
  _windowRef: string | null,
  _sessionRef: string | null
): string {
  return `
tell application "Terminal"
  activate
  try
    set frontmost to true
  end try
end tell
`.trim();
}

export function iTermScript(
  _windowRef: string | null,
  _sessionRef: string | null
): string {
  return `
tell application "iTerm2"
  activate
end tell
`.trim();
}
