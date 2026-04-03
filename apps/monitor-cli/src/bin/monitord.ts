import { homedir } from "node:os";
import { join } from "node:path";
import { createDaemonServer } from "../lib/server.js";

const dataDir = process.env.MONITOR_DATA_DIR ?? join(homedir(), ".monitor-data");
const port = Number(process.env.MONITOR_PORT ?? "45731");

createDaemonServer({ port, dataDir })
  .then((server) => {
    process.stdout.write(
      JSON.stringify({ type: "daemon.started", port: server.port, dataDir }) + "\n"
    );
  })
  .catch((error) => {
    process.stderr.write(String(error) + "\n");
    process.exit(1);
  });
