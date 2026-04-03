export function cursorScript(): string {
  return `
tell application "Cursor"
  activate
end tell
`.trim();
}
