#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectExecution } from "../lib/bin-entry.js";
import { DaemonClient } from "../lib/http-client.js";
import { translateClaudeHook } from "../lib/adapters/claude.js";
import { translateCodexNotify } from "../lib/adapters/codex.js";

export function parseHookArgs(argv: string[]): {
  runner: string;
  taskId: string;
  daemonUrl: string;
  payloadText: string;
} {
  const runnerIndex = argv.findIndex((arg) => arg === "codex" || arg === "claude");
  if (runnerIndex < 0) {
    return { runner: "", taskId: "", daemonUrl: "", payloadText: "{}" };
  }
  const runner = argv[runnerIndex] ?? "";
  const taskId = argv[runnerIndex + 1] ?? "";
  const daemonUrl = argv[runnerIndex + 2] ?? "";
  const positionalPayload = argv[runnerIndex + 3];
  let payloadText: string = positionalPayload ?? "{}";
  if (!payloadText || payloadText.startsWith("-")) {
    payloadText = argv.at(-1) ?? "{}";
  }
  if (!payloadText || payloadText === daemonUrl) {
    payloadText = "{}";
  }
  return { runner, taskId, daemonUrl, payloadText };
}

export function parseHookPayload(payloadText: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(payloadText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through and preserve raw payload
  }
  return { raw: payloadText };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export async function main(): Promise<void> {
  const { runner, taskId, daemonUrl, payloadText } = parseHookArgs(process.argv);
  if (!runner || !taskId || !daemonUrl) {
    throw new Error("Usage: monitor-hook <runner> <taskId> <daemonUrl> [payload]");
  }

  const stdinPayload = await readStdin();
  const client = new DaemonClient(daemonUrl);

  if (runner === "codex") {
    const payload = parseHookPayload(payloadText);
    const event = translateCodexNotify(taskId, payload);
    if (event) {
      await client.postEvent(event);
    }
    return;
  }

  if (runner === "claude") {
    if (
      payloadText !== "Notification" &&
      payloadText !== "Stop" &&
      payloadText !== "SessionEnd"
    ) {
      return;
    }

    await client.postEvent(
      translateClaudeHook(taskId, payloadText, stdinPayload)
    );
  }
}

if (isDirectExecution(fileURLToPath(import.meta.url), process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(String(error) + "\n");
    process.exit(1);
  });
}
