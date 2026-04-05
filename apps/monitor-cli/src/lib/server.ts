import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from "node:http";
import { join } from "node:path";
import { promisify } from "node:util";
import type { TaskEvent, TaskRecord } from "@monitor/contracts";
import { buildFocusScript } from "./focus/router.js";
import { TaskRegistry } from "./registry.js";
import { notifyTask, shouldNotifyTaskUpdate } from "./notification.js";
import { Persistence } from "./persistence.js";
import { applyEvent as applyTaskEvent } from "./state-machine.js";

const execFileAsync = promisify(execFile);

class RequestHandlingError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isCanonicalIsoTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString() === value;
}

function isTaskRecord(value: unknown): value is TaskRecord {
  if (!isObject(value)) return false;
  return (
    typeof value.taskId === "string" &&
    typeof value.name === "string" &&
    (value.runnerType === "codex" || value.runnerType === "claude") &&
    isStringArray(value.rawCommand) &&
    typeof value.cwd === "string" &&
    typeof value.pid === "number" &&
    Number.isFinite(value.pid) &&
    Number.isInteger(value.pid) &&
    (value.hostApp === "terminal" ||
      value.hostApp === "iterm2" ||
      value.hostApp === "cursor" ||
      value.hostApp === "unknown") &&
    isNullableString(value.hostWindowRef) &&
    isNullableString(value.hostSessionRef) &&
    typeof value.startedAt === "string" &&
    typeof value.lastEventAt === "string" &&
    (value.status === "running" ||
      value.status === "waiting_input" ||
      value.status === "waiting_approval" ||
      value.status === "finished" ||
      value.status === "error") &&
    typeof value.lastOutputExcerpt === "string"
  );
}

function parseFocusTaskId(url: string | undefined): string | null {
  if (!url) return null;

  try {
    const pathname = new URL(url, "http://127.0.0.1").pathname;
    const match = /^\/tasks\/([^/]+)\/focus$/.exec(pathname);
    return match ? decodeURIComponent(match[1] ?? "") : null;
  } catch {
    return null;
  }
}

function parseTaskEvent(body: string): TaskEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new RequestHandlingError(400, "bad_request", "Malformed JSON body");
  }

  if (!isObject(parsed)) {
    throw new RequestHandlingError(400, "bad_request", "Event body must be an object");
  }
  if (
    typeof parsed.type !== "string" ||
    typeof parsed.taskId !== "string" ||
    typeof parsed.at !== "string"
  ) {
    throw new RequestHandlingError(400, "bad_request", "Event is missing required fields");
  }
  if (!isCanonicalIsoTimestamp(parsed.at)) {
    throw new RequestHandlingError(400, "bad_request", "Invalid event.at timestamp");
  }

  if (parsed.type === "task.started") {
    if (!isTaskRecord(parsed.payload) || parsed.taskId !== parsed.payload.taskId) {
      throw new RequestHandlingError(400, "bad_request", "Invalid task.started payload");
    }
    if (
      !isCanonicalIsoTimestamp(parsed.payload.startedAt) ||
      !isCanonicalIsoTimestamp(parsed.payload.lastEventAt)
    ) {
      throw new RequestHandlingError(400, "bad_request", "Invalid task.started payload");
    }
    if (parsed.at !== parsed.payload.lastEventAt) {
      throw new RequestHandlingError(400, "bad_request", "Invalid task.started payload");
    }
  } else if (parsed.type === "task.output") {
    if (!isObject(parsed.payload) || typeof parsed.payload.chunk !== "string") {
      throw new RequestHandlingError(400, "bad_request", "Invalid task.output payload");
    }
  } else if (parsed.type === "task.error") {
    if (!isObject(parsed.payload) || typeof parsed.payload.message !== "string") {
      throw new RequestHandlingError(400, "bad_request", "Invalid task.error payload");
    }
  } else if (
    parsed.type !== "task.waiting_input" &&
    parsed.type !== "task.waiting_approval" &&
    parsed.type !== "task.finished"
  ) {
    throw new RequestHandlingError(400, "bad_request", "Unsupported task event type");
  }

  return parsed as unknown as TaskEvent;
}

function resolveNextTask(
  registry: TaskRegistry,
  event: TaskEvent
): TaskRecord | undefined {
  if (event.type === "task.started") {
    const current = registry.get(event.taskId);
    if (
      current &&
      event.payload.lastEventAt.localeCompare(current.lastEventAt) <= 0
    ) {
      return current;
    }
    return event.payload;
  }

  const current = registry.get(event.taskId);
  if (!current) return undefined;

  return applyTaskEvent(current, event);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  registry: TaskRegistry,
  persistence: Persistence,
  daemonMetadata: { scriptPath?: string }
): Promise<void> {
  try {
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, {
        ok: true,
        pid: process.pid,
        scriptPath: daemonMetadata.scriptPath
      });
      return;
    }

    if (req.method === "GET" && req.url === "/tasks") {
      sendJson(res, 200, registry.list());
      return;
    }

    if (req.method === "POST" && req.url === "/events") {
      const event = parseTaskEvent(await readBody(req));
      const previous = registry.get(event.taskId);
      const next = resolveNextTask(registry, event);
      persistence.applyEvent(event, next);
      if (next) registry.upsert(next);
      if (next && shouldNotifyTaskUpdate(previous, next)) {
        await notifyTask(next).catch(() => undefined);
      }
      sendJson(res, 202, { ok: true });
      return;
    }

    const focusTaskId = req.method === "POST" ? parseFocusTaskId(req.url) : null;
    if (focusTaskId) {
      const task = registry.get(focusTaskId);
      if (!task) {
        sendJson(res, 404, { error: "task_not_found", message: "Task not found" });
        return;
      }

      try {
        const script = buildFocusScript(task);
        await execFileAsync("osascript", ["-e", script]);
        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendJson(res, 409, {
          ok: false,
          reason: "focus_failed",
          message: String(error)
        });
      }
      return;
    }

    sendJson(res, 404, { error: "not_found", message: "Route not found" });
  } catch (error) {
    if (error instanceof RequestHandlingError) {
      sendJson(res, error.statusCode, { error: error.code, message: error.message });
      return;
    }
    sendJson(res, 500, { error: "internal_error", message: "Internal server error" });
  }
}

export async function createDaemonServer(options: {
  port: number;
  dataDir: string;
  scriptPath?: string;
}) {
  mkdirSync(options.dataDir, { recursive: true });
  const persistence = new Persistence(join(options.dataDir, "monitor.sqlite"));
  const registry = new TaskRegistry();
  for (const task of persistence.loadTasks()) registry.upsert(task);

  const server = createServer((req, res) => {
    void handleRequest(req, res, registry, persistence, {
      scriptPath: options.scriptPath
    });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };

      server.once("listening", onListening);
      server.once("error", onError);
      server.listen(options.port, "127.0.0.1");
    });
  } catch (error) {
    persistence.close();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === "string") {
    persistence.close();
    throw new Error("server failed to bind");
  }

  return {
    port: address.port,
    close: async () => {
      try {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      } finally {
        persistence.close();
      }
    }
  };
}
