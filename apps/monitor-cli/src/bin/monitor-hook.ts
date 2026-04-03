import { DaemonClient } from "../lib/http-client.js";
import { translateCodexNotify } from "../lib/adapters/codex.js";

async function main(): Promise<void> {
  const [, , runner, taskId, daemonUrl, rawPayload] = process.argv;
  if (!runner || !taskId || !daemonUrl) {
    throw new Error("Usage: monitor-hook <runner> <taskId> <daemonUrl> [payload]");
  }

  if (runner !== "codex") return;

  const payloadText = rawPayload ?? "{}";
  const payload = JSON.parse(payloadText) as Record<string, unknown>;
  const client = new DaemonClient(daemonUrl);
  await client.postEvent(translateCodexNotify(taskId, payload));
}

main().catch((error) => {
  process.stderr.write(String(error) + "\n");
  process.exit(1);
});
