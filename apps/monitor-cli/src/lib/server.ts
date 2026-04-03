import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import type { TaskEvent } from "@monitor/contracts";
import { TaskRegistry } from "./registry.js";
import { Persistence } from "./persistence.js";

export async function createDaemonServer(options: {
  port: number;
  dataDir: string;
}) {
  mkdirSync(options.dataDir, { recursive: true });
  const persistence = new Persistence(join(options.dataDir, "monitor.sqlite"));
  const registry = new TaskRegistry();
  for (const task of persistence.loadTasks()) registry.upsert(task);

  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/tasks") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(registry.list()));
      return;
    }

    if (req.method === "POST" && req.url === "/events") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const event = JSON.parse(Buffer.concat(chunks).toString("utf8")) as TaskEvent;
      const next = registry.apply(event);
      persistence.appendEvent(event);
      if (next) persistence.saveTask(next);
      res.statusCode = 202;
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not_found" }));
  });

  await new Promise<void>((resolve) =>
    server.listen(options.port, "127.0.0.1", resolve)
  );
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server failed to bind");
  }

  return {
    port: address.port,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  };
}
