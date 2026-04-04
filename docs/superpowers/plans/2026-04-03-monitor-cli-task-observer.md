# Monitor CLI Task Observer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a macOS-only monitor system that launches `codex` and `claude` through `monitor`, tracks task state in a local daemon, shows tasks in a Tauri menu bar app, and returns the user to the original task from notifications.

**Architecture:** Use an npm workspace with one shared contracts package, one Node/TypeScript package for the launcher and daemon, and one Tauri app for the menu bar UI. The launcher emits normalized task events to a local daemon over loopback HTTP, the daemon persists recent tasks in SQLite and sends clickable macOS notifications, and the menu bar app consumes daemon APIs and deep links to open task detail or trigger focus-back behavior.

**Tech Stack:** Node.js, TypeScript, npm workspaces, Vitest, better-sqlite3, Tauri 2, Rust, AppleScript, terminal-notifier

---

## Planned File Structure

### Workspace root

- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`

### Shared contracts

- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/index.test.ts`

### Launcher and daemon

- Create: `apps/monitor-cli/package.json`
- Create: `apps/monitor-cli/tsconfig.json`
- Create: `apps/monitor-cli/src/bin/monitor.ts`
- Create: `apps/monitor-cli/src/bin/monitord.ts`
- Create: `apps/monitor-cli/src/bin/monitor-hook.ts`
- Create: `apps/monitor-cli/src/lib/state-machine.ts`
- Create: `apps/monitor-cli/src/lib/registry.ts`
- Create: `apps/monitor-cli/src/lib/persistence.ts`
- Create: `apps/monitor-cli/src/lib/server.ts`
- Create: `apps/monitor-cli/src/lib/http-client.ts`
- Create: `apps/monitor-cli/src/lib/host-metadata.ts`
- Create: `apps/monitor-cli/src/lib/notification.ts`
- Create: `apps/monitor-cli/src/lib/adapters/codex.ts`
- Create: `apps/monitor-cli/src/lib/adapters/claude.ts`
- Create: `apps/monitor-cli/src/lib/focus/router.ts`
- Create: `apps/monitor-cli/src/lib/focus/apple-script.ts`
- Create: `apps/monitor-cli/src/lib/focus/cursor.ts`
- Test: `apps/monitor-cli/tests/state-machine.test.ts`
- Test: `apps/monitor-cli/tests/server.test.ts`
- Test: `apps/monitor-cli/tests/codex-adapter.test.ts`
- Test: `apps/monitor-cli/tests/claude-adapter.test.ts`
- Test: `apps/monitor-cli/tests/focus-router.test.ts`

### Menu bar app

- Create: `apps/monitor-app/` via `npm create tauri-app@latest`
- Modify: `apps/monitor-app/package.json`
- Modify: `apps/monitor-app/src/main.ts`
- Create: `apps/monitor-app/src/api.ts`
- Create: `apps/monitor-app/src/store.ts`
- Create: `apps/monitor-app/src/render.ts`
- Create: `apps/monitor-app/src/deep-link.ts`
- Modify: `apps/monitor-app/src/styles.css`
- Modify: `apps/monitor-app/src-tauri/Cargo.toml`
- Modify: `apps/monitor-app/src-tauri/tauri.conf.json`
- Modify: `apps/monitor-app/src-tauri/src/lib.rs`
- Test: `apps/monitor-app/src/store.test.ts`
- Test: `apps/monitor-app/src/deep-link.test.ts`

### Docs

- Create: `README.md`
- Create: `docs/verification/monitor-v1-checklist.md`

## Task 1: Bootstrap Workspace And Shared Contracts

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/index.test.ts`

- [ ] **Step 1: Initialize the repository and workspace skeleton**

Run:

```bash
if [ ! -d .git ]; then git init; fi
npm init -y
npm pkg set name="monitor-cli-task-observer"
npm pkg set private=true
npm pkg set workspaces[0]="apps/*"
npm pkg set workspaces[1]="packages/*"
npm pkg set scripts.build="npm run -ws build"
npm pkg set scripts.test="npm run -ws test"
npm pkg set scripts.lint="npm run -ws lint"
mkdir -p packages/contracts/src apps/monitor-cli/src/bin apps/monitor-cli/src/lib apps/monitor-cli/tests
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

Create `.gitignore`:

```gitignore
node_modules
dist
.DS_Store
apps/monitor-app/src-tauri/target
apps/monitor-app/dist
apps/monitor-cli/.monitor-data
```

- [ ] **Step 2: Write the failing contracts test**

Create `packages/contracts/package.json`:

```json
{
  "name": "@monitor/contracts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "lint": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.8.3",
    "vitest": "^3.2.4"
  }
}
```

Create `packages/contracts/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src/**/*.ts"]
}
```

Create `packages/contracts/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  isWaitingState,
  type TaskEvent,
  type TaskRecord,
} from "./index.js";

describe("contracts", () => {
  it("marks waiting_input and waiting_approval as waiting states", () => {
    expect(isWaitingState("waiting_input")).toBe(true);
    expect(isWaitingState("waiting_approval")).toBe(true);
    expect(isWaitingState("running")).toBe(false);
  });

  it("allows the daemon to model task records and events", () => {
    const task: TaskRecord = {
      taskId: "task-1",
      name: "api-fix",
      runnerType: "codex",
      rawCommand: ["codex"],
      cwd: "/tmp/project",
      pid: 123,
      hostApp: "cursor",
      hostWindowRef: "cursor-window-1",
      hostSessionRef: "session-1",
      startedAt: "2026-04-03T08:00:00.000Z",
      lastEventAt: "2026-04-03T08:00:00.000Z",
      status: "running",
      lastOutputExcerpt: ""
    };

    const event: TaskEvent = {
      type: "task.finished",
      taskId: task.taskId,
      at: "2026-04-03T08:01:00.000Z"
    };

    expect(task.status).toBe("running");
    expect(event.type).toBe("task.finished");
  });
});
```

- [ ] **Step 3: Run the contracts test and verify it fails**

Run:

```bash
npm install
npm run -w @monitor/contracts test
```

Expected: FAIL with a module resolution error for `./index.js` exports that do not exist yet.

- [ ] **Step 4: Implement the shared contract types**

Create `packages/contracts/src/index.ts`:

```ts
export type RunnerType = "codex" | "claude";
export type TaskStatus =
  | "running"
  | "waiting_input"
  | "waiting_approval"
  | "finished"
  | "error";

export type HostApp = "terminal" | "iterm2" | "cursor" | "unknown";

export interface TaskRecord {
  taskId: string;
  name: string;
  runnerType: RunnerType;
  rawCommand: string[];
  cwd: string;
  pid: number;
  hostApp: HostApp;
  hostWindowRef: string;
  hostSessionRef: string;
  startedAt: string;
  lastEventAt: string;
  status: TaskStatus;
  lastOutputExcerpt: string;
}

interface TaskEventBase {
  taskId: string;
  at: string;
}

export type TaskEvent =
  | ({ type: "task.started"; payload: TaskRecord } & TaskEventBase)
  | ({ type: "task.output"; payload: { chunk: string } } & TaskEventBase)
  | ({ type: "task.waiting_input" } & TaskEventBase)
  | ({ type: "task.waiting_approval" } & TaskEventBase)
  | ({ type: "task.finished" } & TaskEventBase)
  | ({ type: "task.error"; payload: { message: string } } & TaskEventBase);

export function isWaitingState(status: TaskStatus): boolean {
  return status === "waiting_input" || status === "waiting_approval";
}
```

- [ ] **Step 5: Run the contracts test and verify it passes**

Run:

```bash
npm run -w @monitor/contracts test
npm run -w @monitor/contracts lint
```

Expected: PASS with `2 passed`.

- [ ] **Step 6: Commit**

Run:

```bash
git add package.json tsconfig.base.json .gitignore packages/contracts
git commit -m "chore: bootstrap workspace and shared contracts"
```

## Task 2: Implement Task State Machine And Registry

**Files:**
- Create: `apps/monitor-cli/package.json`
- Create: `apps/monitor-cli/tsconfig.json`
- Create: `apps/monitor-cli/src/lib/state-machine.ts`
- Create: `apps/monitor-cli/src/lib/registry.ts`
- Test: `apps/monitor-cli/tests/state-machine.test.ts`

- [ ] **Step 1: Write the failing state machine tests**

Create `apps/monitor-cli/package.json`:

```json
{
  "name": "@monitor/cli",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "monitor": "dist/bin/monitor.js",
    "monitord": "dist/bin/monitord.js",
    "monitor-hook": "dist/bin/monitor-hook.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "lint": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@monitor/contracts": "0.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.15.3",
    "typescript": "^5.8.3",
    "vitest": "^3.2.4"
  }
}
```

Create `apps/monitor-cli/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

Create `apps/monitor-cli/tests/state-machine.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { TaskRecord } from "@monitor/contracts";
import { applyEvent } from "../src/lib/state-machine.js";
import { TaskRegistry } from "../src/lib/registry.js";

function makeTask(): TaskRecord {
  return {
    taskId: "task-1",
    name: "api-fix",
    runnerType: "codex",
    rawCommand: ["codex"],
    cwd: "/tmp/project",
    pid: 321,
    hostApp: "terminal",
    hostWindowRef: "window-1",
    hostSessionRef: "tab-1",
    startedAt: "2026-04-03T08:00:00.000Z",
    lastEventAt: "2026-04-03T08:00:00.000Z",
    status: "running",
    lastOutputExcerpt: ""
  };
}

describe("applyEvent", () => {
  it("moves a running task into waiting_approval", () => {
    const next = applyEvent(makeTask(), {
      type: "task.waiting_approval",
      taskId: "task-1",
      at: "2026-04-03T08:01:00.000Z"
    });

    expect(next.status).toBe("waiting_approval");
  });

  it("returns to running after output arrives", () => {
    const waiting = { ...makeTask(), status: "waiting_input" as const };
    const next = applyEvent(waiting, {
      type: "task.output",
      taskId: "task-1",
      at: "2026-04-03T08:01:00.000Z",
      payload: { chunk: "continuing work" }
    });

    expect(next.status).toBe("running");
    expect(next.lastOutputExcerpt).toContain("continuing work");
  });
});

describe("TaskRegistry", () => {
  it("stores and updates tasks by id", () => {
    const registry = new TaskRegistry();
    const task = makeTask();

    registry.upsert(task);
    registry.apply({
      type: "task.finished",
      taskId: task.taskId,
      at: "2026-04-03T08:02:00.000Z"
    });

    expect(registry.get(task.taskId)?.status).toBe("finished");
    expect(registry.listActive()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm install
npm run -w @monitor/cli test -- state-machine.test.ts
```

Expected: FAIL with missing `state-machine.js` and `registry.js`.

- [ ] **Step 3: Implement the state machine and registry**

Create `apps/monitor-cli/src/lib/state-machine.ts`:

```ts
import type { TaskEvent, TaskRecord } from "@monitor/contracts";

export function applyEvent(task: TaskRecord, event: TaskEvent): TaskRecord {
  switch (event.type) {
    case "task.output":
      return {
        ...task,
        status:
          task.status === "waiting_input" || task.status === "waiting_approval"
            ? "running"
            : task.status,
        lastEventAt: event.at,
        lastOutputExcerpt: event.payload.chunk.slice(-240)
      };
    case "task.waiting_input":
      return { ...task, status: "waiting_input", lastEventAt: event.at };
    case "task.waiting_approval":
      return { ...task, status: "waiting_approval", lastEventAt: event.at };
    case "task.finished":
      return { ...task, status: "finished", lastEventAt: event.at };
    case "task.error":
      return {
        ...task,
        status: "error",
        lastEventAt: event.at,
        lastOutputExcerpt: event.payload.message
      };
    default:
      return task;
  }
}
```

Create `apps/monitor-cli/src/lib/registry.ts`:

```ts
import type { TaskEvent, TaskRecord } from "@monitor/contracts";
import { applyEvent } from "./state-machine.js";

export class TaskRegistry {
  #tasks = new Map<string, TaskRecord>();

  upsert(task: TaskRecord): void {
    this.#tasks.set(task.taskId, task);
  }

  apply(event: TaskEvent): TaskRecord | undefined {
    if (event.type === "task.started") {
      this.upsert(event.payload);
      return event.payload;
    }

    const current = this.#tasks.get(event.taskId);
    if (!current) return undefined;

    const next = applyEvent(current, event);
    this.#tasks.set(event.taskId, next);
    return next;
  }

  get(taskId: string): TaskRecord | undefined {
    return this.#tasks.get(taskId);
  }

  list(): TaskRecord[] {
    return [...this.#tasks.values()].sort((a, b) =>
      b.lastEventAt.localeCompare(a.lastEventAt)
    );
  }

  listActive(): TaskRecord[] {
    return this.list().filter(
      (task) => task.status === "running" || task.status.startsWith("waiting_")
    );
  }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```bash
npm run -w @monitor/cli test -- state-machine.test.ts
npm run -w @monitor/cli lint
```

Expected: PASS with `3 passed`.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/monitor-cli/package.json apps/monitor-cli/tsconfig.json apps/monitor-cli/src/lib/state-machine.ts apps/monitor-cli/src/lib/registry.ts apps/monitor-cli/tests/state-machine.test.ts
git commit -m "feat: add task state machine and registry"
```

## Task 3: Build Daemon HTTP API And SQLite Persistence

**Files:**
- Create: `apps/monitor-cli/src/lib/persistence.ts`
- Create: `apps/monitor-cli/src/lib/server.ts`
- Create: `apps/monitor-cli/src/lib/http-client.ts`
- Create: `apps/monitor-cli/src/bin/monitord.ts`
- Test: `apps/monitor-cli/tests/server.test.ts`

- [ ] **Step 1: Write the failing daemon API test**

Create `apps/monitor-cli/tests/server.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDaemonServer } from "../src/lib/server.js";

describe("daemon server", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("accepts task events and returns tasks", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "monitor-daemon-"));
    dirs.push(dataDir);
    const server = await createDaemonServer({ port: 0, dataDir });

    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      await fetch(`${baseUrl}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "task.started",
          taskId: "task-1",
          at: "2026-04-03T08:00:00.000Z",
          payload: {
            taskId: "task-1",
            name: "api-fix",
            runnerType: "codex",
            rawCommand: ["codex"],
            cwd: "/tmp/project",
            pid: 123,
            hostApp: "terminal",
            hostWindowRef: "window-1",
            hostSessionRef: "tab-1",
            startedAt: "2026-04-03T08:00:00.000Z",
            lastEventAt: "2026-04-03T08:00:00.000Z",
            status: "running",
            lastOutputExcerpt: ""
          }
        })
      });

      const response = await fetch(`${baseUrl}/tasks`);
      const tasks = (await response.json()) as Array<{ taskId: string; name: string }>;

      expect(tasks).toEqual([{ taskId: "task-1", name: "api-fix" }]);
    } finally {
      await server.close();
    }
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm install --workspace @monitor/cli better-sqlite3
npm run -w @monitor/cli test -- server.test.ts
```

Expected: FAIL with missing `server.js`.

- [ ] **Step 3: Implement persistence, HTTP transport, and the daemon entrypoint**

Create `apps/monitor-cli/src/lib/persistence.ts`:

```ts
import Database from "better-sqlite3";
import type { TaskEvent, TaskRecord } from "@monitor/contracts";

export class Persistence {
  #db: Database.Database;

  constructor(filePath: string) {
    this.#db = new Database(filePath);
    this.#db.exec(`
      create table if not exists tasks (
        task_id text primary key,
        json text not null
      );
      create table if not exists task_events (
        id integer primary key autoincrement,
        task_id text not null,
        type text not null,
        at text not null,
        json text not null
      );
    `);
  }

  saveTask(task: TaskRecord): void {
    this.#db
      .prepare("insert into tasks(task_id, json) values (?, ?) on conflict(task_id) do update set json=excluded.json")
      .run(task.taskId, JSON.stringify(task));
  }

  appendEvent(event: TaskEvent): void {
    this.#db
      .prepare("insert into task_events(task_id, type, at, json) values (?, ?, ?, ?)")
      .run(event.taskId, event.type, event.at, JSON.stringify(event));
  }

  loadTasks(): TaskRecord[] {
    return this.#db
      .prepare("select json from tasks order by rowid desc")
      .all()
      .map((row: { json: string }) => JSON.parse(row.json) as TaskRecord);
  }
}
```

Create `apps/monitor-cli/src/lib/server.ts`:

```ts
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import type { TaskEvent } from "@monitor/contracts";
import { TaskRegistry } from "./registry.js";
import { Persistence } from "./persistence.js";

export async function createDaemonServer(options: { port: number; dataDir: string }) {
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

  await new Promise<void>((resolve) => server.listen(options.port, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server failed to bind");

  return {
    port: address.port,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  };
}
```

Create `apps/monitor-cli/src/lib/http-client.ts`:

```ts
import type { TaskEvent, TaskRecord } from "@monitor/contracts";

export class DaemonClient {
  constructor(private readonly baseUrl: string) {}

  async postEvent(event: TaskEvent): Promise<void> {
    await fetch(`${this.baseUrl}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event)
    });
  }

  async listTasks(): Promise<TaskRecord[]> {
    const response = await fetch(`${this.baseUrl}/tasks`);
    return (await response.json()) as TaskRecord[];
  }
}
```

Create `apps/monitor-cli/src/bin/monitord.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```bash
npm run -w @monitor/cli test -- server.test.ts
npm run -w @monitor/cli lint
```

Expected: PASS with `1 passed`.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/monitor-cli/src/lib/persistence.ts apps/monitor-cli/src/lib/server.ts apps/monitor-cli/src/lib/http-client.ts apps/monitor-cli/src/bin/monitord.ts apps/monitor-cli/tests/server.test.ts package-lock.json
git commit -m "feat: add daemon api and sqlite persistence"
```

## Task 4: Implement `monitor codex` And The Codex Adapter

**Files:**
- Create: `apps/monitor-cli/src/bin/monitor.ts`
- Create: `apps/monitor-cli/src/bin/monitor-hook.ts`
- Create: `apps/monitor-cli/src/lib/host-metadata.ts`
- Create: `apps/monitor-cli/src/lib/adapters/codex.ts`
- Test: `apps/monitor-cli/tests/codex-adapter.test.ts`

- [ ] **Step 1: Write the failing Codex adapter tests**

Create `apps/monitor-cli/tests/codex-adapter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildCodexCommand, detectCodexWaitState, translateCodexNotify } from "../src/lib/adapters/codex.js";

describe("buildCodexCommand", () => {
  it("injects a notify override that points to monitor-hook", () => {
    const args = buildCodexCommand({
      taskId: "task-1",
      daemonUrl: "http://127.0.0.1:45731",
      hookCommand: ["/usr/bin/node", "/tmp/monitor-hook.js"],
      forwardedArgs: ["codex", "--model", "gpt-5-codex"]
    });

    expect(args).toContain("-c");
    expect(args.join(" ")).toContain("notify");
    expect(args.join(" ")).toContain("/tmp/monitor-hook.js");
  });
});

describe("translateCodexNotify", () => {
  it("maps agent-turn-complete into task.finished", () => {
    const event = translateCodexNotify("task-1", {
      type: "agent-turn-complete",
      "turn-id": "123",
      "input-messages": ["rename foo to bar"],
      "last-assistant-message": "done"
    });

    expect(event.type).toBe("task.finished");
  });
});

describe("detectCodexWaitState", () => {
  it("detects approval prompts from stdout", () => {
    expect(detectCodexWaitState("Do you want to allow this command?")).toBe(
      "waiting_approval"
    );
    expect(detectCodexWaitState("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm run -w @monitor/cli test -- codex-adapter.test.ts
```

Expected: FAIL with missing `codex.js`.

- [ ] **Step 3: Implement host metadata, the Codex adapter, and the launcher**

Create `apps/monitor-cli/src/lib/host-metadata.ts`:

```ts
import type { HostApp } from "@monitor/contracts";

export function detectHostApp(termProgram = process.env.TERM_PROGRAM ?? ""): HostApp {
  if (termProgram.toLowerCase().includes("apple_terminal")) return "terminal";
  if (termProgram.toLowerCase().includes("iterm")) return "iterm2";
  if (process.env.CURSOR_TRACE_ID || process.env.CURSOR_AGENT) return "cursor";
  if ((process.env.TERM_PROGRAM_VERSION ?? "").includes("Cursor")) return "cursor";
  return "unknown";
}
```

Create `apps/monitor-cli/src/lib/adapters/codex.ts`:

```ts
import type { TaskEvent } from "@monitor/contracts";

export function buildCodexCommand(options: {
  taskId: string;
  daemonUrl: string;
  hookCommand: string[];
  forwardedArgs: string[];
}): string[] {
  const notify = JSON.stringify([
    ...options.hookCommand,
    "codex",
    options.taskId,
    options.daemonUrl
  ]);

  return [
    ...options.forwardedArgs,
    "-c",
    `notify=${notify}`
  ];
}

export function translateCodexNotify(
  taskId: string,
  payload: Record<string, unknown>
): TaskEvent {
  return {
    type: "task.finished",
    taskId,
    at: new Date().toISOString()
  };
}

export function detectCodexWaitState(
  line: string
): "waiting_input" | "waiting_approval" | null {
  if (/allow this command|approval/i.test(line)) return "waiting_approval";
  if (/press enter|waiting for input/i.test(line)) return "waiting_input";
  return null;
}
```

Create `apps/monitor-cli/src/bin/monitor-hook.ts`:

```ts
import { DaemonClient } from "../lib/http-client.js";
import { translateCodexNotify } from "../lib/adapters/codex.js";

async function main() {
  const [, , runner, taskId, daemonUrl, rawPayload] = process.argv;
  const raw = rawPayload ?? process.argv.at(-1) ?? "{}";
  const payload = runner === "codex" ? JSON.parse(raw) : raw;
  const client = new DaemonClient(daemonUrl);

  if (runner === "codex") {
    await client.postEvent(translateCodexNotify(taskId, payload));
  }
}

main().catch((error) => {
  process.stderr.write(String(error) + "\n");
  process.exit(1);
});
```

Create `apps/monitor-cli/src/bin/monitor.ts`:

```ts
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DaemonClient } from "../lib/http-client.js";
import { buildCodexCommand, detectCodexWaitState } from "../lib/adapters/codex.js";
import { detectHostApp } from "../lib/host-metadata.js";
import type { TaskRecord } from "@monitor/contracts";

async function main() {
  const daemonUrl = process.env.MONITOR_DAEMON_URL ?? "http://127.0.0.1:45731";
  const forwardedArgs = process.argv.slice(2);
  const [runner, ...rest] = forwardedArgs;
  if (runner !== "codex") throw new Error("Task 4 only supports monitor codex");

  const taskId = randomUUID();
  const nameArgIndex = rest.indexOf("--name");
  const name = nameArgIndex >= 0 ? rest[nameArgIndex + 1] : `codex-${taskId.slice(0, 8)}`;
  const client = new DaemonClient(daemonUrl);
  const hookPath = join(dirname(fileURLToPath(import.meta.url)), "monitor-hook.js");
  const command = buildCodexCommand({
    taskId,
    daemonUrl,
    hookCommand: [process.execPath, hookPath],
    forwardedArgs: ["codex", ...rest.filter((arg) => arg !== "--name" && arg !== name)]
  });

  const child = spawn(command[0], command.slice(1), {
    stdio: ["inherit", "pipe", "pipe"]
  });

  const task: TaskRecord = {
    taskId,
    name,
    runnerType: "codex",
    rawCommand: command,
    cwd: process.cwd(),
    pid: child.pid ?? -1,
    hostApp: detectHostApp(),
    hostWindowRef: process.env.WINDOWID ?? "unknown",
    hostSessionRef: process.env.TMUX_PANE ?? "unknown",
    startedAt: new Date().toISOString(),
    lastEventAt: new Date().toISOString(),
    status: "running",
    lastOutputExcerpt: ""
  };

  await client.postEvent({
    type: "task.started",
    taskId,
    at: task.startedAt,
    payload: task
  });

  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding("utf8");
    stream?.on("data", async (chunk: string) => {
      process.stdout.write(chunk);
      const wait = detectCodexWaitState(chunk);
      await client.postEvent({
        type: wait ? `task.${wait}` : "task.output",
        taskId,
        at: new Date().toISOString(),
        ...(wait ? {} : { payload: { chunk } })
      } as any);
    });
  }

  child.on("exit", async (code) => {
    if (code && code !== 0) {
      await client.postEvent({
        type: "task.error",
        taskId,
        at: new Date().toISOString(),
        payload: { message: `codex exited with code ${code}` }
      });
    }
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  process.stderr.write(String(error) + "\n");
  process.exit(1);
});
```

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```bash
npm run -w @monitor/cli test -- codex-adapter.test.ts
npm run -w @monitor/cli lint
```

Expected: PASS with `3 passed`.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/monitor-cli/src/bin/monitor.ts apps/monitor-cli/src/bin/monitor-hook.ts apps/monitor-cli/src/lib/host-metadata.ts apps/monitor-cli/src/lib/adapters/codex.ts apps/monitor-cli/tests/codex-adapter.test.ts
git commit -m "feat: add monitor codex launcher and adapter"
```

## Task 5: Scaffold The Tauri Menu Bar App, Tray Shell, And Task Detail View

**Files:**
- Create: `apps/monitor-app/` via Tauri generator
- Modify: `apps/monitor-app/package.json`
- Create: `apps/monitor-app/src/api.ts`
- Create: `apps/monitor-app/src/store.ts`
- Create: `apps/monitor-app/src/render.ts`
- Modify: `apps/monitor-app/src/main.ts`
- Modify: `apps/monitor-app/src/styles.css`
- Modify: `apps/monitor-app/src-tauri/src/lib.rs`
- Test: `apps/monitor-app/src/store.test.ts`

- [ ] **Step 1: Generate the app shell and write the failing UI view-model test**

Run:

```bash
npm create tauri-app@latest apps/monitor-app -- --template vanilla-ts --manager npm
```

Create `apps/monitor-app/src/store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { TaskRecord } from "@monitor/contracts";
import { buildTaskViewModel } from "./store";

const tasks: TaskRecord[] = [
  {
    taskId: "1",
    name: "api-fix",
    runnerType: "codex",
    rawCommand: ["codex"],
    cwd: "/tmp/project",
    pid: 1,
    hostApp: "cursor",
    hostWindowRef: "window-1",
    hostSessionRef: "pane-1",
    startedAt: "2026-04-03T08:00:00.000Z",
    lastEventAt: "2026-04-03T08:02:00.000Z",
    status: "waiting_approval",
    lastOutputExcerpt: "Do you want to allow this command?"
  },
  {
    taskId: "2",
    name: "auth-debug",
    runnerType: "claude",
    rawCommand: ["claude"],
    cwd: "/tmp/project",
    pid: 2,
    hostApp: "terminal",
    hostWindowRef: "window-2",
    hostSessionRef: "tab-2",
    startedAt: "2026-04-03T08:01:00.000Z",
    lastEventAt: "2026-04-03T08:03:00.000Z",
    status: "running",
    lastOutputExcerpt: ""
  }
];

describe("buildTaskViewModel", () => {
  it("counts active and unread alert tasks", () => {
    expect(buildTaskViewModel(tasks).summary).toEqual({
      activeCount: 2,
      unreadAlertCount: 1
    });
  });

  it("keeps a selected task ready for the detail panel", () => {
    expect(buildTaskViewModel(tasks, "1").selectedTask).toMatchObject({
      taskId: "1",
      name: "api-fix",
      cwd: "/tmp/project",
      status: "waiting_approval",
      lastOutputExcerpt: "Do you want to allow this command?"
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm install
npm run -w monitor-app test -- src/store.test.ts
```

Expected: FAIL with missing `buildTaskViewModel` export or missing workspace dependency on `@monitor/contracts`.

- [ ] **Step 3: Implement the API client, view-model store, rendering, and tray shell**

Modify `apps/monitor-app/package.json` to include:

```json
{
  "dependencies": {
    "@monitor/contracts": "0.1.0"
  },
  "devDependencies": {
    "vitest": "^3.2.4"
  },
  "scripts": {
    "test": "vitest run"
  }
}
```

Create `apps/monitor-app/src/api.ts`:

```ts
import type { TaskRecord } from "@monitor/contracts";

const BASE_URL = "http://127.0.0.1:45731";

export async function fetchTasks(): Promise<TaskRecord[]> {
  const response = await fetch(`${BASE_URL}/tasks`);
  return (await response.json()) as TaskRecord[];
}
```

Create `apps/monitor-app/src/store.ts`:

```ts
import type { TaskRecord } from "@monitor/contracts";

export interface TaskViewModel {
  summary: {
    activeCount: number;
    unreadAlertCount: number;
  };
  tasks: TaskRecord[];
  selectedTask: TaskRecord | null;
}

export function buildTaskViewModel(
  tasks: TaskRecord[],
  selectedTaskId?: string
): TaskViewModel {
  const selectedTask =
    tasks.find((task) => task.taskId === selectedTaskId) ??
    tasks.find((task) => task.status.startsWith("waiting_")) ??
    tasks[0] ??
    null;

  return {
    summary: {
      activeCount: tasks.filter(
        (task) => task.status === "running" || task.status.startsWith("waiting_")
      ).length,
      unreadAlertCount: tasks.filter((task) => task.status.startsWith("waiting_")).length
    },
    tasks,
    selectedTask
  };
}
```

Create `apps/monitor-app/src/render.ts`:

```ts
import type { TaskRecord } from "@monitor/contracts";
import type { TaskViewModel } from "./store";

function renderTaskRow(task: TaskRecord, selectedTaskId?: string): string {
  const selectedClass = task.taskId === selectedTaskId ? " selected" : "";

  return `
    <button class="task-row${selectedClass}" data-task-id="${task.taskId}">
      <strong>${task.name}</strong>
      <span>${task.runnerType}</span>
      <span>${task.status}</span>
      <span class="task-meta">${new Date(task.lastEventAt).toLocaleTimeString()}</span>
    </button>
  `;
}

export function renderTasks(root: HTMLElement, viewModel: TaskViewModel) {
  const detail = viewModel.selectedTask;

  root.innerHTML = `
    <section class="summary">
      <span class="summary-pill">Active ${viewModel.summary.activeCount}</span>
      <span class="summary-pill alert">Alerts ${viewModel.summary.unreadAlertCount}</span>
    </section>
    <section class="task-list">
      ${viewModel.tasks.map((task) => renderTaskRow(task, detail?.taskId)).join("")}
    </section>
    <section class="task-detail">
      ${
        detail
          ? `
            <header class="task-detail-header">
              <div>
                <h2>${detail.name}</h2>
                <p>${detail.runnerType} · ${detail.status}</p>
              </div>
              <button class="focus-task" data-task-id="${detail.taskId}">Focus task</button>
            </header>
            <dl>
              <dt>Command</dt>
              <dd>${detail.rawCommand.join(" ")}</dd>
              <dt>Working directory</dt>
              <dd>${detail.cwd}</dd>
              <dt>Recent output</dt>
              <dd>${detail.lastOutputExcerpt || "No output captured yet."}</dd>
            </dl>
          `
          : `<p class="muted">Select a task to inspect it.</p>`
      }
    </section>
  `;
}
```

Modify `apps/monitor-app/src/main.ts`:

```ts
import "./styles.css";
import { fetchTasks } from "./api";
import { renderTasks } from "./render";
import { buildTaskViewModel } from "./store";

const root = document.querySelector<HTMLDivElement>("#app");
let selectedTaskId: string | undefined;

async function refresh() {
  if (!root) return;
  const tasks = await fetchTasks();
  const viewModel = buildTaskViewModel(tasks, selectedTaskId);
  selectedTaskId = viewModel.selectedTask?.taskId;
  document.title = `Monitor (${viewModel.summary.unreadAlertCount})`;
  renderTasks(root, viewModel);
}

root?.addEventListener("click", (event) => {
  const taskId = (event.target as HTMLElement)
    .closest<HTMLElement>(".task-row")
    ?.dataset.taskId;
  if (!taskId) return;
  selectedTaskId = taskId;
  void refresh();
});

void refresh();
window.setInterval(() => void refresh(), 2000);
```

Modify `apps/monitor-app/src/styles.css`:

```css
body {
  margin: 0;
  font-family: "SF Pro Text", "Helvetica Neue", sans-serif;
  background:
    radial-gradient(circle at top, rgba(255, 241, 215, 0.9), transparent 40%),
    linear-gradient(180deg, #f4ecdd 0%, #efe6d6 100%);
  color: #1f1d17;
}

#app {
  display: grid;
  gap: 12px;
  padding: 12px;
  min-width: 360px;
}

.summary {
  display: flex;
  gap: 8px;
}

.summary-pill {
  border-radius: 999px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(138, 109, 68, 0.2);
  font-size: 12px;
}

.summary-pill.alert {
  background: #fff0d6;
}

.task-list {
  display: grid;
  gap: 8px;
}

.task-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 6px 8px;
  border: 1px solid #d7ccb8;
  border-radius: 12px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.9);
  text-align: left;
}

.task-row.selected {
  border-color: #9a6b2f;
  box-shadow: 0 0 0 1px rgba(154, 107, 47, 0.2);
}

.task-meta {
  grid-column: 1 / -1;
  color: #6b6458;
  font-size: 12px;
}

.task-detail {
  border: 1px solid #d7ccb8;
  border-radius: 14px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.92);
}

.task-detail-header {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 12px;
}

.focus-task {
  border: 0;
  border-radius: 10px;
  padding: 8px 10px;
  background: #1f1d17;
  color: white;
}

.task-detail dl {
  margin: 0;
  display: grid;
  gap: 6px;
}

.task-detail dt {
  font-size: 12px;
  color: #6b6458;
}

.task-detail dd {
  margin: 0 0 8px;
  word-break: break-word;
}

.muted {
  color: #6b6458;
}
```

Modify `apps/monitor-app/src-tauri/src/lib.rs`:

```rust
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let icon = app.default_window_icon().cloned().expect("default icon");

            let _ = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("index.html".into()),
            )
            .title("Monitor")
            .inner_size(380.0, 560.0)
            .visible(false)
            .resizable(false)
            .build()?;

            TrayIconBuilder::with_id("monitor-tray")
                .icon(icon)
                .tooltip("Monitor")
                .on_tray_icon_event(move |_tray, event| {
                    if let TrayIconEvent::Click { .. } = event {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run:

```bash
npm install
npm run -w monitor-app test -- src/store.test.ts
npm run -w monitor-app build
```

Expected: PASS with `2 passed`, then a successful Tauri frontend build.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/monitor-app
git commit -m "feat: scaffold menu bar app task views"
```

## Task 6: Add Clickable Notifications And Deep-Link Routing

**Files:**
- Create: `apps/monitor-cli/src/lib/notification.ts`
- Modify: `apps/monitor-app/package.json`
- Create: `apps/monitor-app/src/deep-link.ts`
- Create: `apps/monitor-app/src/deep-link.test.ts`
- Modify: `apps/monitor-cli/src/lib/server.ts`
- Modify: `apps/monitor-app/src/main.ts`
- Modify: `apps/monitor-app/src-tauri/Cargo.toml`
- Modify: `apps/monitor-app/src-tauri/tauri.conf.json`
- Modify: `apps/monitor-app/src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing deep-link parsing test**

Create `apps/monitor-app/src/deep-link.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseTaskUrl } from "./deep-link";

describe("parseTaskUrl", () => {
  it("extracts task ids from monitor deep links", () => {
    expect(parseTaskUrl("monitor://task/task-123")).toEqual({ taskId: "task-123" });
    expect(parseTaskUrl("https://example.com")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm install --workspace @monitor/cli terminal-notifier
npm run -w monitor-app test -- src/deep-link.test.ts
```

Expected: FAIL with missing `deep-link` module.

- [ ] **Step 3: Implement macOS notifications and deep-link handling**

Modify `apps/monitor-app/package.json` to add:

```json
{
  "dependencies": {
    "@tauri-apps/plugin-deep-link": "^2.0.0"
  }
}
```

Create `apps/monitor-cli/src/lib/notification.ts`:

```ts
import { spawn } from "node:child_process";
import type { TaskRecord } from "@monitor/contracts";

export async function notifyTask(task: TaskRecord): Promise<void> {
  if (!task.status.startsWith("waiting_") && task.status !== "finished" && task.status !== "error") {
    return;
  }

  const message =
    task.status === "finished"
      ? `${task.name} finished`
      : task.status === "error"
        ? `${task.name} failed`
        : `${task.name} ${task.status === "waiting_approval" ? "needs approval" : "needs input"}`;

  await new Promise<void>((resolve, reject) => {
    const child = spawn("terminal-notifier", [
      "-title",
      "Monitor",
      "-message",
      message,
      "-group",
      task.taskId,
      "-open",
      `monitor://task/${task.taskId}`
    ]);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`terminal-notifier exit ${code}`))));
  });
}
```

Modify `apps/monitor-cli/src/lib/server.ts` inside the `/events` handler:

```ts
import { notifyTask } from "./notification.js";
```

and after `if (next) persistence.saveTask(next);` add:

```ts
      if (next) {
        persistence.saveTask(next);
        await notifyTask(next).catch(() => undefined);
      }
```

Create `apps/monitor-app/src/deep-link.ts`:

```ts
export function parseTaskUrl(url: string): { taskId: string } | null {
  const match = url.match(/^monitor:\/\/task\/(.+)$/);
  return match ? { taskId: match[1] } : null;
}
```

Modify `apps/monitor-app/src/main.ts`:

```ts
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { parseTaskUrl } from "./deep-link";
```

and add:

```ts
async function handleUrls(urls: string[]) {
  const first = urls
    .map(parseTaskUrl)
    .find((value): value is { taskId: string } => value !== null);
  if (!first) return;
  selectedTaskId = first.taskId;
  await refresh();
}

void getCurrent().then((urls) => {
  if (urls) void handleUrls(urls);
});

void onOpenUrl((urls) => {
  void handleUrls(urls);
});
```

Modify `apps/monitor-app/src-tauri/Cargo.toml` to add:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-deep-link = "2"
tauri-plugin-opener = "2"
```

Modify `apps/monitor-app/src-tauri/tauri.conf.json` to include:

```json
{
  "plugins": {
    "deep-link": {
      "desktop": {
        "schemes": ["monitor"]
      }
    }
  }
}
```

Modify `apps/monitor-app/src-tauri/src/lib.rs`:

```rust
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
```

- [ ] **Step 4: Run the test and verify it passes**

Run:

```bash
npm install
npm run -w monitor-app test -- src/deep-link.test.ts
npm run -w @monitor/cli lint
```

Expected: PASS with `1 passed`.

- [ ] **Step 5: Manually verify deep-link routing on macOS**

Run:

```bash
npm run -w monitor-app tauri dev
```

Keep the dev app running, then from a second terminal run:

```bash
open "monitor://task/manual-test-1"
```

Expected: the running app receives the `monitor://task/manual-test-1` URL, selects the matching task, and brings the menu bar window forward with that task detail visible.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/monitor-cli/src/lib/notification.ts apps/monitor-cli/src/lib/server.ts apps/monitor-app/package.json apps/monitor-app/src/deep-link.ts apps/monitor-app/src/deep-link.test.ts apps/monitor-app/src/main.ts apps/monitor-app/src-tauri/Cargo.toml apps/monitor-app/src-tauri/tauri.conf.json apps/monitor-app/src-tauri/src/lib.rs package-lock.json
git commit -m "feat: add clickable notifications and deep link routing"
```

## Task 7: Implement Focus-Back For Terminal.app And iTerm2

**Files:**
- Create: `apps/monitor-cli/src/lib/focus/apple-script.ts`
- Create: `apps/monitor-cli/src/lib/focus/router.ts`
- Test: `apps/monitor-cli/tests/focus-router.test.ts`
- Modify: `apps/monitor-cli/src/lib/server.ts`
- Modify: `apps/monitor-app/src/main.ts`

- [ ] **Step 1: Write the failing focus routing test**

Create `apps/monitor-cli/tests/focus-router.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildFocusScript } from "../src/lib/focus/router.js";

describe("buildFocusScript", () => {
  it("returns Terminal.app AppleScript for terminal tasks", () => {
    const script = buildFocusScript({
      hostApp: "terminal",
      hostWindowRef: "window-1",
      hostSessionRef: "tab-1"
    });

    expect(script).toContain('tell application "Terminal"');
  });

  it("returns iTerm2 AppleScript for iterm tasks", () => {
    const script = buildFocusScript({
      hostApp: "iterm2",
      hostWindowRef: "window-1",
      hostSessionRef: "session-1"
    });

    expect(script).toContain('tell application "iTerm2"');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm run -w @monitor/cli test -- focus-router.test.ts
```

Expected: FAIL with missing `router.js`.

- [ ] **Step 3: Implement AppleScript generation and a focus endpoint**

Create `apps/monitor-cli/src/lib/focus/apple-script.ts`:

```ts
export function terminalScript(windowRef: string): string {
  return `
    tell application "Terminal"
      activate
      try
        set frontmost to true
      end try
    end tell
  `;
}

export function iTermScript(): string {
  return `
    tell application "iTerm2"
      activate
    end tell
  `;
}
```

Create `apps/monitor-cli/src/lib/focus/router.ts`:

```ts
import type { HostApp } from "@monitor/contracts";
import { iTermScript, terminalScript } from "./apple-script.js";

export function buildFocusScript(task: {
  hostApp: HostApp;
  hostWindowRef: string;
  hostSessionRef: string;
}): string {
  if (task.hostApp === "terminal") return terminalScript(task.hostWindowRef);
  if (task.hostApp === "iterm2") return iTermScript();
  throw new Error(`unsupported host app: ${task.hostApp}`);
}
```

Modify `apps/monitor-cli/src/lib/server.ts` to add:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildFocusScript } from "./focus/router.js";

const execFileAsync = promisify(execFile);
```

and before the final `404` branch add:

```ts
    if (req.method === "POST" && req.url?.startsWith("/tasks/") && req.url.endsWith("/focus")) {
      const taskId = req.url.split("/")[2];
      const task = registry.get(taskId);
      if (!task) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "task_not_found" }));
        return;
      }

      try {
        const script = buildFocusScript(task);
        await execFileAsync("osascript", ["-e", script]);
        res.end(JSON.stringify({ ok: true }));
      } catch (error) {
        res.statusCode = 409;
        res.end(
          JSON.stringify({
            ok: false,
            reason: "focus_failed",
            message: String(error)
          })
        );
      }
      return;
    }
```

Modify `apps/monitor-app/src/main.ts` to replace the click handling with:

```ts
root?.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement;
  const taskId = target.closest<HTMLElement>("[data-task-id]")?.dataset.taskId;
  if (!taskId) return;

  selectedTaskId = taskId;
  const response = await fetch(`http://127.0.0.1:45731/tasks/${taskId}/focus`, {
    method: "POST"
  });
  const result = (await response.json()) as { ok: boolean };
  await refresh();
  if (!result.ok) return;
});
```

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```bash
npm run -w @monitor/cli test -- focus-router.test.ts
npm run -w @monitor/cli lint
```

Expected: PASS with `2 passed`.

- [ ] **Step 5: Manually verify focus-back in Terminal.app and iTerm2**

Run:

```bash
osascript -e 'tell application "Terminal" to activate'
osascript -e 'tell application "iTerm2" to activate'
```

Expected: each host app comes to the foreground. Then click a task row from the menu bar app and confirm the matching terminal app activates. If focus fails, the selected task still remains visible in the detail panel and the retry button stays available.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/monitor-cli/src/lib/focus/apple-script.ts apps/monitor-cli/src/lib/focus/router.ts apps/monitor-cli/tests/focus-router.test.ts apps/monitor-cli/src/lib/server.ts apps/monitor-app/src/main.ts
git commit -m "feat: add terminal and iterm focus back"
```

## Task 8: Add Claude Hooks Integration

**Files:**
- Create: `apps/monitor-cli/src/lib/adapters/claude.ts`
- Test: `apps/monitor-cli/tests/claude-adapter.test.ts`
- Modify: `apps/monitor-cli/src/bin/monitor.ts`
- Modify: `apps/monitor-cli/src/bin/monitor-hook.ts`

- [ ] **Step 1: Write the failing Claude adapter test**

Create `apps/monitor-cli/tests/claude-adapter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildClaudeSettings, translateClaudeHook } from "../src/lib/adapters/claude.js";

describe("buildClaudeSettings", () => {
  it("creates Notification and Stop hooks that invoke monitor-hook", () => {
    const settings = buildClaudeSettings({
      taskId: "task-1",
      daemonUrl: "http://127.0.0.1:45731",
      hookCommand: ["/usr/bin/node", "/tmp/monitor-hook.js"]
    });

    expect(settings.hooks.Notification[0].hooks[0].command).toContain("/tmp/monitor-hook.js");
    expect(settings.hooks.Stop[0].hooks[0].command).toContain("/tmp/monitor-hook.js");
  });
});

describe("translateClaudeHook", () => {
  it("maps Notification payloads to waiting_input or waiting_approval and Stop to finished", () => {
    expect(
      translateClaudeHook("task-1", "Notification", "{\"message\":\"needs approval\"}").type
    ).toBe("task.waiting_approval");
    expect(
      translateClaudeHook("task-1", "Notification", "{\"message\":\"waiting for input\"}").type
    ).toBe("task.waiting_input");
    expect(translateClaudeHook("task-1", "Stop", "").type).toBe("task.finished");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm run -w @monitor/cli test -- claude-adapter.test.ts
```

Expected: FAIL with missing `claude.js`.

- [ ] **Step 3: Implement Claude settings generation and hook relay support**

Create `apps/monitor-cli/src/lib/adapters/claude.ts`:

```ts
import type { TaskEvent } from "@monitor/contracts";

export function buildClaudeSettings(options: {
  taskId: string;
  daemonUrl: string;
  hookCommand: string[];
}) {
  const base = `${options.hookCommand.join(" ")} claude ${options.taskId} ${options.daemonUrl}`;

  return {
    hooks: {
      Notification: [
        {
          hooks: [
            {
              type: "command",
              command: `${base} Notification`
            }
          ]
        }
      ],
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command: `${base} Stop`
            }
          ]
        }
      ]
    }
  };
}

export function translateClaudeHook(
  taskId: string,
  hookName: "Notification" | "Stop",
  hookPayload = ""
): TaskEvent {
  const waitingType = /approve|approval|allow|permission/i.test(hookPayload)
    ? "task.waiting_approval"
    : "task.waiting_input";

  return {
    type: hookName === "Stop" ? "task.finished" : waitingType,
    taskId,
    at: new Date().toISOString()
  };
}
```

Modify `apps/monitor-cli/src/bin/monitor-hook.ts`:

```ts
import { translateClaudeHook } from "../lib/adapters/claude.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
```

and replace the handler body with:

```ts
  const stdinPayload = await readStdin();

  if (runner === "codex") {
    await client.postEvent(translateCodexNotify(taskId, payload));
    return;
  }

  if (runner === "claude") {
    await client.postEvent(
      translateClaudeHook(taskId, payload as "Notification" | "Stop", stdinPayload)
    );
  }
```

Modify `apps/monitor-cli/src/bin/monitor.ts` to support `claude`:

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { buildClaudeSettings } from "../lib/adapters/claude.js";
```

and in `main()` after `const [runner, ...rest] = forwardedArgs;` branch:

```ts
  const hookPath = join(dirname(fileURLToPath(import.meta.url)), "monitor-hook.js");
  const baseHookCommand = [process.execPath, hookPath];
  let command: string[];

  if (runner === "codex") {
    command = buildCodexCommand({
      taskId,
      daemonUrl,
      hookCommand: baseHookCommand,
      forwardedArgs: ["codex", ...rest.filter((arg) => arg !== "--name" && arg !== name)]
    });
  } else if (runner === "claude") {
    const settings = buildClaudeSettings({ taskId, daemonUrl, hookCommand: baseHookCommand });
    const settingsDir = mkdtempSync(join(tmpdir(), "monitor-claude-"));
    const settingsPath = join(settingsDir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    command = ["claude", "--settings", settingsPath, "-n", name, ...rest.filter((arg) => arg !== "--name" && arg !== name)];
  } else {
    throw new Error(`unsupported runner: ${runner}`);
  }
```

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```bash
npm run -w @monitor/cli test -- claude-adapter.test.ts
npm run -w @monitor/cli lint
```

Expected: PASS with `2 passed`.

- [ ] **Step 5: Manually verify Claude waiting and finish notifications**

Run:

```bash
npm run -w @monitor/cli build
node apps/monitor-cli/dist/bin/monitor.js claude --name auth-debug
```

Expected: a Claude session starts with injected hooks, waiting states show up in the daemon task list, and stopping the session emits a finished event.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/monitor-cli/src/lib/adapters/claude.ts apps/monitor-cli/tests/claude-adapter.test.ts apps/monitor-cli/src/bin/monitor.ts apps/monitor-cli/src/bin/monitor-hook.ts
git commit -m "feat: add claude hooks integration"
```

## Task 9: Add Cursor Activation, README, And Final Verification

**Files:**
- Create: `apps/monitor-cli/src/lib/focus/cursor.ts`
- Modify: `apps/monitor-cli/src/lib/focus/router.ts`
- Create: `README.md`
- Create: `docs/verification/monitor-v1-checklist.md`
- Test: `apps/monitor-cli/tests/focus-router.test.ts`

- [ ] **Step 1: Extend the focus test for Cursor**

Append to `apps/monitor-cli/tests/focus-router.test.ts`:

```ts
  it("returns a Cursor activation script for cursor tasks", () => {
    const script = buildFocusScript({
      hostApp: "cursor",
      hostWindowRef: "cursor-window-1",
      hostSessionRef: "pane-1"
    });

    expect(script).toContain('tell application "Cursor"');
  });
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm run -w @monitor/cli test -- focus-router.test.ts
```

Expected: FAIL with `unsupported host app: cursor`.

- [ ] **Step 3: Implement Cursor activation and end-user docs**

Create `apps/monitor-cli/src/lib/focus/cursor.ts`:

```ts
export function cursorScript(): string {
  return `
    tell application "Cursor"
      activate
    end tell
  `;
}
```

Modify `apps/monitor-cli/src/lib/focus/router.ts`:

```ts
import { cursorScript } from "./cursor.js";
```

and extend `buildFocusScript`:

```ts
  if (task.hostApp === "cursor") return cursorScript();
```

Create `README.md`:

```md
# Monitor CLI Task Observer

## Development

1. `npm install`
2. `npm run -w @monitor/cli build`
3. `npm run -w monitor-app tauri dev`
4. `node apps/monitor-cli/dist/bin/monitord.js`
5. `node apps/monitor-cli/dist/bin/monitor.js codex --name api-fix`

## Notes

- macOS only for v1
- requires Automation and Accessibility permissions for focus-back
- Cursor focus is best-effort and currently activates the Cursor window
```

Create `docs/verification/monitor-v1-checklist.md`:

```md
# Monitor V1 Verification Checklist

- [ ] `monitord` starts and serves `GET /tasks`
- [ ] `monitor codex --name api-fix` creates a running task
- [ ] The menu bar window shows correct `Active` and `Alerts` counters
- [ ] Codex completion creates a finished notification
- [ ] Claude Notification hook creates a waiting task
- [ ] Claude Stop hook creates a finished task
- [ ] Clicking a notification opens the app with the matching task
- [ ] The selected task detail shows command, cwd, and recent output
- [ ] Clicking a task row focuses Terminal.app
- [ ] Clicking a task row focuses iTerm2
- [ ] Clicking a task row activates Cursor
- [ ] If focus fails, the task remains visible in the detail view and the retry focus button remains usable
```

- [ ] **Step 4: Run the tests and full verification suite**

Run:

```bash
npm run test
npm run build
```

Expected: all workspace tests pass and both the CLI package and Tauri app build successfully.

- [ ] **Step 5: Execute the manual checklist**

Run:

```bash
open -a Terminal
open -a iTerm
open -a Cursor
```

Then walk through `docs/verification/monitor-v1-checklist.md` and mark each item complete only after manual confirmation.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/monitor-cli/src/lib/focus/cursor.ts apps/monitor-cli/src/lib/focus/router.ts README.md docs/verification/monitor-v1-checklist.md apps/monitor-cli/tests/focus-router.test.ts
git commit -m "feat: finish cursor activation and verification docs"
```
