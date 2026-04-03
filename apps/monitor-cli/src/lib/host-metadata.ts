import type { HostApp } from "@monitor/contracts";

export interface HostMetadata {
  hostApp: HostApp;
  hostWindowRef: string | null;
  hostSessionRef: string | null;
}

export function detectHostApp(termProgram = process.env.TERM_PROGRAM ?? ""): HostApp {
  const normalizedTermProgram = termProgram.toLowerCase();
  if (normalizedTermProgram.includes("apple_terminal")) return "terminal";
  if (normalizedTermProgram.includes("iterm")) return "iterm2";

  if (
    process.env.CURSOR_TRACE_ID ||
    process.env.CURSOR_AGENT ||
    (process.env.TERM_PROGRAM_VERSION ?? "").includes("Cursor")
  ) {
    return "cursor";
  }

  return "unknown";
}

export function detectHostMetadata(): HostMetadata {
  return {
    hostApp: detectHostApp(),
    hostWindowRef: process.env.WINDOWID ?? process.env.TERM_SESSION_ID ?? null,
    hostSessionRef:
      process.env.TMUX_PANE ??
      process.env.CURSOR_TRACE_ID ??
      process.env.CURSOR_AGENT ??
      null
  };
}
