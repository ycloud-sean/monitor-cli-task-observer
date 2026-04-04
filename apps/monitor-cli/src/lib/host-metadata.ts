import { execFileSync } from "node:child_process";
import { basename } from "node:path";
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
  cursorWindowRef?: string | null;
  cursorWindowRefResolver?: () => string | null;
  ttyRef?: string | null;
  cwd?: string | null;
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
    normalizedTermProgram === "vscode" ||
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

function parseCursorWindowSnapshotLines(lines: string[]): CursorWindowSnapshot | null {
  const [titleLine, documentLine, positionLine, sizeLine] = lines;
  if (!titleLine) return null;

  const parseNumberPair = (value: string | undefined): [number | null, number | null] => {
    if (!value) return [null, null];
    const match = /^\s*(-?\d+)\s*,\s*(-?\d+)\s*$/.exec(value);
    if (!match) return [null, null];
    return [Number(match[1]), Number(match[2])];
  };

  const [x, y] = parseNumberPair(positionLine);
  const [width, height] = parseNumberPair(sizeLine);
  const document = documentLine || null;
  const workspaceMatch = /\/([^/]+?)(?:\/)?$/.exec(document ?? "");

  return {
    title: titleLine || null,
    document,
    workspace: workspaceMatch?.[1] ?? null,
    x,
    y,
    width,
    height
  };
}

function serializeCursorWindowSnapshot(snapshot: CursorWindowSnapshot): string {
  return `cursor-window:${JSON.stringify(snapshot)}`;
}

function normalizeCursorWindowRef(
  windowRef: string | null,
  cwd: string | null
): string | null {
  if (!windowRef?.startsWith("cursor-window:")) {
    return windowRef;
  }

  try {
    const snapshot = JSON.parse(windowRef.slice("cursor-window:".length)) as CursorWindowSnapshot;
    const documentBasename = /\/([^/]+?)(?:\/)?$/.exec(snapshot.document ?? "")?.[1] ?? null;
    const shouldNormalize =
      !snapshot.workspace ||
      snapshot.workspace === documentBasename ||
      /\.[A-Za-z0-9]+$/.test(snapshot.workspace);

    if (!shouldNormalize) {
      return windowRef;
    }

    const workspace = cwd ? basename(cwd) : snapshot.workspace;
    if (!workspace || workspace === snapshot.workspace) {
      return windowRef;
    }

    return serializeCursorWindowSnapshot({
      ...snapshot,
      workspace
    });
  } catch {
    return windowRef;
  }
}

export function resolveCursorWindowRef(): string | null {
  try {
    const output = execFileSync(
      "osascript",
      [
        "-e",
        'tell application "System Events"',
        "-e",
        'if not (exists process "Cursor") then return ""',
        "-e",
        'tell process "Cursor"',
        "-e",
        'if (count of windows) is 0 then return ""',
        "-e",
        "set targetWindow to front window",
        "-e",
        'set titleValue to (value of attribute "AXTitle" of targetWindow as text)',
        "-e",
        'set documentValue to (value of attribute "AXDocument" of targetWindow as text)',
        "-e",
        'set positionValue to (value of attribute "AXPosition" of targetWindow)',
        "-e",
        'set sizeValue to (value of attribute "AXSize" of targetWindow)',
        "-e",
        'return titleValue & linefeed & documentValue & linefeed & (item 1 of positionValue as text) & "," & (item 2 of positionValue as text) & linefeed & (item 1 of sizeValue as text) & "," & (item 2 of sizeValue as text)',
        "-e",
        "end tell",
        "-e",
        "end tell"
      ],
      { encoding: "utf8" }
    ).trim();

    if (!output) {
      return null;
    }

    const snapshot = parseCursorWindowSnapshotLines(output.split(/\r?\n/));
    return snapshot ? serializeCursorWindowSnapshot(snapshot) : null;
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
  const hostApp = detectHostApp(
    termProgram,
    termProgramVersion,
    cursorTraceId ?? "",
    cursorAgent ?? ""
  );
  const cursorWindowRef =
    options.cursorWindowRef !== undefined
      ? options.cursorWindowRef
      : hostApp === "cursor"
        ? (options.cursorWindowRefResolver ?? resolveCursorWindowRef)()
        : null;
  const cwd = options.cwd ?? process.cwd();
  const termSessionId = options.termSessionId ?? process.env.TERM_SESSION_ID ?? null;
  const ttyRef = options.ttyRef === undefined ? resolveTtyRef() : options.ttyRef;

  if (hostApp === "cursor") {
    return {
      hostApp,
      hostWindowRef:
        cursorTraceId ??
        options.windowId ??
        process.env.WINDOWID ??
        normalizeCursorWindowRef(cursorWindowRef, cwd) ??
        null,
      hostSessionRef: cursorAgent
    };
  }

  return {
    hostApp,
    hostWindowRef: options.windowId ?? process.env.WINDOWID ?? termSessionId,
    hostSessionRef: ttyRef ?? termSessionId
  };
}
