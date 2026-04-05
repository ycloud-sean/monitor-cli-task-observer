export interface CursorWindowSnapshot {
  title: string | null;
  document: string | null;
  workspace: string | null;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
}

export function parseCursorWindowRef(
  windowRef: string | null
): CursorWindowSnapshot | null {
  if (!windowRef?.startsWith("cursor-window:")) {
    return null;
  }

  try {
    return JSON.parse(windowRef.slice("cursor-window:".length)) as CursorWindowSnapshot;
  } catch {
    return null;
  }
}
