#!/usr/bin/env node

import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectExecution } from "../lib/bin-entry.js";
import { createDaemonServer } from "../lib/server.js";

const dataDir = process.env.MONITOR_DATA_DIR ?? join(homedir(), ".monitor-data");
const port = Number(process.env.MONITOR_PORT ?? "45731");

function main(): void {
  createDaemonServer({
    port,
    dataDir,
    scriptPath: fileURLToPath(import.meta.url)
  })
    .then((server) => {
      process.stdout.write(
        JSON.stringify({ type: "daemon.started", port: server.port, dataDir }) + "\n"
      );
    })
    .catch((error) => {
      process.stderr.write(String(error) + "\n");
      process.exit(1);
    });
}

if (isDirectExecution(fileURLToPath(import.meta.url), process.argv[1])) {
  main();
}
