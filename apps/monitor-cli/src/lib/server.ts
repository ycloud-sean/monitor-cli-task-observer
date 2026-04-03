import { mkdirSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from "node:http";
import { join } from "node:path";
import type { TaskEvent } from "@monitor/contracts";
import { TaskRegistry } from "./registry.js";
import { Persistence } from "./persistence.js";

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

  if (parsed.type === "task.started") {
    if (
      !isObject(parsed.payload) ||
      typeof parsed.payload.taskId !== "string" ||
      typeof parsed.payload.lastEventAt !== "string"
    ) {
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

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  registry: TaskRegistry,
  persistence: Persistence
): Promise<void> {
  try {
    if (req.method === "GET" && req.url === "/tasks") {
      sendJson(res, 200, registry.list());
      return;
    }

    if (req.method === "POST" && req.url === "/events") {
      const event = parseTaskEvent(await readBody(req));
      const next = registry.apply(event);
      persistence.appendEvent(event);
      if (next) persistence.saveTask(next);
      sendJson(res, 202, { ok: true });
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
}) {
  mkdirSync(options.dataDir, { recursive: true });
  const persistence = new Persistence(join(options.dataDir, "monitor.sqlite"));
  const registry = new TaskRegistry();
  for (const task of persistence.loadTasks()) registry.upsert(task);

  const server = createServer((req, res) => {
    void handleRequest(req, res, registry, persistence);
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
