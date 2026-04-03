import { execFileSync } from "node:child_process";
import type { HostApp } from "@monitor/contracts";

export interface HostMetadata {
  hostApp: HostApp;
  hostWindowRef: string | null;
  hostSessionRef: string | null;
}

export interface DetectHostMetadataOptions {
  termProgram?: string;
  termProgramVersion?: string;
  windowId?: string | null;
  termSessionId?: string | null;
  cursorTraceId?: string | null;
  cursorAgent?: string | null;
  ttyRef?: string | null;
}

export function detectHostApp(
  termProgram = process.env.TERM_PROGRAM ?? "",
  termProgramVersion = process.env.TERM_PROGRAM_VERSION ?? "",
  cursorTraceId = process.env.CURSOR_TRACE_ID ?? "",
  cursorAgent = process.env.CURSOR_AGENT ?? ""
): HostApp {
  const normalizedTermProgram = termProgram.toLowerCase();
  if (normalizedTermProgram.includes("apple_terminal")) return "terminal";
  if (normalizedTermProgram.includes("iterm")) return "iterm2";

  if (
    cursorTraceId ||
    cursorAgent ||
    termProgramVersion.includes("Cursor")
  ) {
    return "cursor";
  }

  return "unknown";
}

export function resolveTtyRef(pid = process.pid): string | null {
  try {
    const ttyName = execFileSync("ps", ["-p", String(pid), "-o", "tty="], {
      encoding: "utf8"
    }).trim();
    if (!ttyName || ttyName === "??") {
      return null;
    }

    return ttyName.startsWith("/dev/") ? ttyName : `/dev/${ttyName}`;
  } catch {
    return null;
  }
}

export function detectHostMetadata(
  options: DetectHostMetadataOptions = {}
): HostMetadata {
  const termProgram = options.termProgram ?? process.env.TERM_PROGRAM ?? "";
  const termProgramVersion =
    options.termProgramVersion ?? process.env.TERM_PROGRAM_VERSION ?? "";
  const cursorTraceId = options.cursorTraceId ?? process.env.CURSOR_TRACE_ID ?? null;
  const cursorAgent = options.cursorAgent ?? process.env.CURSOR_AGENT ?? null;
  const termSessionId = options.termSessionId ?? process.env.TERM_SESSION_ID ?? null;
  const ttyRef = options.ttyRef === undefined ? resolveTtyRef() : options.ttyRef;
  const hostApp = detectHostApp(
    termProgram,
    termProgramVersion,
    cursorTraceId ?? "",
    cursorAgent ?? ""
  );

  if (hostApp === "cursor") {
    return {
      hostApp,
      hostWindowRef: cursorTraceId,
      hostSessionRef: cursorAgent
    };
  }

  return {
    hostApp,
    hostWindowRef: options.windowId ?? process.env.WINDOWID ?? termSessionId,
    hostSessionRef: ttyRef ?? termSessionId
  };
}
