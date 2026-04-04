export const CURSOR_BRIDGE_EXTENSION_ID = "liangxin.monitor-cursor-bridge";

export type CursorBridgeAction = "register" | "focus";

export function buildCursorBridgeUri(
  action: CursorBridgeAction,
  params: Record<string, string | null | undefined> = {}
): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (!value) continue;
    searchParams.set(key, value);
  }

  const query = searchParams.toString();
  return `cursor://${CURSOR_BRIDGE_EXTENSION_ID}/${action}${query ? `?${query}` : ""}`;
}
