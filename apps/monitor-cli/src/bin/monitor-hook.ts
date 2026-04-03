import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DaemonClient } from "../lib/http-client.js";
import { translateCodexNotify } from "../lib/adapters/codex.js";

export function parseHookArgs(argv: string[]): {
  runner: string;
  taskId: string;
  daemonUrl: string;
  payloadText: string;
} {
  const runnerIndex = argv.findIndex((arg) => arg === "codex");
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

export async function main(): Promise<void> {
  const { runner, taskId, daemonUrl, payloadText } = parseHookArgs(process.argv);
  if (!runner || !taskId || !daemonUrl) {
    throw new Error("Usage: monitor-hook <runner> <taskId> <daemonUrl> [payload]");
  }

  if (runner !== "codex") return;

  const payload = parseHookPayload(payloadText);
  const client = new DaemonClient(daemonUrl);
  const event = translateCodexNotify(taskId, payload);
  if (event) {
    await client.postEvent(event);
  }
}

const isDirectExecution = process.argv[1]
  ? fileURLToPath(import.meta.url) === resolve(process.argv[1])
  : false;

if (isDirectExecution) {
  main().catch((error) => {
    process.stderr.write(String(error) + "\n");
    process.exit(1);
  });
}
