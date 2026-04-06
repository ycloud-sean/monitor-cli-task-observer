const vscode = require("vscode");
const { appendFileSync, mkdirSync } = require("node:fs");
const { homedir } = require("node:os");
const { join } = require("node:path");
const {
  forgetTerminal,
  getTerminalCwd,
  getTerminalProcessId,
  resolveTerminal,
  resolveTerminalByCwd,
  resolveTerminalByProcessId,
  resolveTerminalByMonitorPid
} = require("./lib/registry");
const {
  enqueuePendingFocusRequest,
  getPendingFocusRequestStorePath,
  pruneExpiredPendingFocusRequests,
  readPendingFocusRequests,
  writePendingFocusRequests
} = require("./lib/focus-queue");
const { revealTerminal } = require("./lib/terminal-focus");
const { activateCursorApp, raiseCursorWindow } = require("./lib/window-focus");
const { parseMonitorUri } = require("./lib/uri");
const {
  buildWorkspaceRouteFocusUri,
  extractWorkspaceFromWindowRef,
  shouldRouteFocusRequest
} = require("./lib/workspace-routing");

const TASK_STATE_KEY = "monitor.cursor.task-state.v1";
const CURSOR_DEBUG_LOG_FILE = "cursor-focus-debug.jsonl";
const PENDING_FOCUS_POLL_INTERVAL_MS = 250;
const PENDING_FOCUS_WARNING_DELAY_MS = 1500;
const taskRegistry = new Map();
let taskStateRegistry = new Map();
let extensionContext = null;
let focusRequestStorePath = null;
let focusRequestPollTimer = null;
let processingPendingFocusRequests = false;
const pendingFocusWarningTimers = new Map();
const extensionInstanceId = `${process.pid}-${Date.now()}`;

function appendCursorDebugLog(event, payload = {}) {
  try {
    const dataDir = process.env.MONITOR_DATA_DIR ?? join(homedir(), ".monitor-data");
    mkdirSync(dataDir, { recursive: true });
    appendFileSync(
      join(dataDir, CURSOR_DEBUG_LOG_FILE),
      `${JSON.stringify({
        ts: new Date().toISOString(),
        scope: "cursor-extension",
        pid: process.pid,
        instanceId: extensionInstanceId,
        event,
        ...payload
      })}\n`,
      "utf8"
    );
  } catch {
    // Debug logging is best-effort only.
  }
}

async function describeTerminal(terminal) {
  if (!terminal) {
    return null;
  }

  return {
    name: terminal.name ?? null,
    cwd: getTerminalCwd(terminal) ?? null,
    processId: await getTerminalProcessId(terminal)
  };
}

function getCurrentWorkspaceName() {
  if (typeof vscode.workspace.name === "string" && vscode.workspace.name) {
    return vscode.workspace.name;
  }

  if (Array.isArray(vscode.workspace.workspaceFolders) && vscode.workspace.workspaceFolders.length > 0) {
    return vscode.workspace.workspaceFolders[0]?.name ?? null;
  }

  return null;
}

function getOutputChannel() {
  if (!getOutputChannel.channel) {
    getOutputChannel.channel = vscode.window.createOutputChannel("Monitor Cursor Bridge");
  }

  return getOutputChannel.channel;
}

function loadTaskStateRegistry(context) {
  const stored = context.globalState.get(TASK_STATE_KEY, {});
  if (!stored || typeof stored !== "object") {
    return new Map();
  }

  return new Map(
    Object.entries(stored)
      .filter(([, value]) => value && typeof value === "object")
      .map(([taskId, value]) => [
        taskId,
        {
          terminalProcessId: Number.isInteger(value.terminalProcessId)
            ? value.terminalProcessId
            : null,
          cwd: typeof value.cwd === "string" ? value.cwd : null
        }
      ])
  );
}

async function persistTaskStateRegistry() {
  if (!extensionContext) {
    return;
  }

  await extensionContext.globalState.update(
    TASK_STATE_KEY,
    Object.fromEntries(taskStateRegistry.entries())
  );
}

async function rememberTaskTerminal(taskId, terminal, cwd = null) {
  taskRegistry.set(taskId, terminal);

  taskStateRegistry.set(taskId, {
    terminalProcessId: await getTerminalProcessId(terminal),
    cwd: getTerminalCwd(terminal) ?? cwd ?? null
  });
  await persistTaskStateRegistry();
}

async function forgetPersistedTerminal(terminal) {
  const processId = await getTerminalProcessId(terminal);
  if (!processId) {
    return;
  }

  let changed = false;
  for (const [taskId, state] of taskStateRegistry.entries()) {
    if (state?.terminalProcessId === processId) {
      taskStateRegistry.delete(taskId);
      changed = true;
    }
  }

  if (changed) {
    await persistTaskStateRegistry();
  }
}

async function resolveFocusedTerminal(taskId, cwd, processId) {
  const registeredTerminal = taskRegistry.get(taskId);
  if (registeredTerminal && vscode.window.terminals.includes(registeredTerminal)) {
    return { terminal: registeredTerminal, source: "memory" };
  }

  const savedState = taskStateRegistry.get(taskId);
  if (savedState?.terminalProcessId) {
    const terminal = await resolveTerminalByProcessId(
      vscode.window.terminals,
      savedState.terminalProcessId
    );
    if (terminal) {
      return { terminal, source: "persisted-process" };
    }
  }

  if (processId) {
    const terminal = await resolveTerminalByMonitorPid(vscode.window.terminals, processId);
    if (terminal) {
      return { terminal, source: "process-ancestry" };
    }
  }

  const terminal = resolveTerminal(taskRegistry, taskId, vscode.window.terminals, cwd);
  if (terminal) {
    return { terminal, source: "cwd" };
  }

  return { terminal: null, source: "missing" };
}

function clearPendingFocusWarning(taskId) {
  const timeout = pendingFocusWarningTimers.get(taskId);
  if (!timeout) {
    return;
  }

  clearTimeout(timeout);
  pendingFocusWarningTimers.delete(taskId);
}

async function maybeWarnPendingFocusMiss(taskId) {
  clearPendingFocusWarning(taskId);

  const requests = await readPendingFocusRequests(focusRequestStorePath);
  if (!requests.has(taskId)) {
    return;
  }

  requests.delete(taskId);
  await writePendingFocusRequests(focusRequestStorePath, requests);
  appendCursorDebugLog("focus-queue-expired", { taskId });
  getOutputChannel().appendLine(`focus miss ${taskId}: shared queue expired`);
  vscode.window.showWarningMessage(`未找到任务 ${taskId.slice(0, 8)} 对应的终端。`);
}

function schedulePendingFocusWarning(taskId) {
  clearPendingFocusWarning(taskId);
  const timeout = setTimeout(() => {
    void maybeWarnPendingFocusMiss(taskId);
  }, PENDING_FOCUS_WARNING_DELAY_MS);
  pendingFocusWarningTimers.set(taskId, timeout);
}

async function deferFocusToOwningWindow(parsed, output) {
  if (!focusRequestStorePath) {
    appendCursorDebugLog("focus-defer-skipped", {
      taskId: parsed?.taskId ?? null,
      reason: "missing-store-path"
    });
    return false;
  }

  const requests = await readPendingFocusRequests(focusRequestStorePath);
  if (!enqueuePendingFocusRequest(requests, parsed)) {
    appendCursorDebugLog("focus-defer-skipped", {
      taskId: parsed?.taskId ?? null,
      reason: "enqueue-rejected"
    });
    return false;
  }

  await writePendingFocusRequests(focusRequestStorePath, requests);
  appendCursorDebugLog("focus-deferred", {
    taskId: parsed.taskId,
    cwd: parsed.cwd,
    monitorPid: parsed.monitorPid,
    windowRef: parsed.windowRef
  });
  output.appendLine(`focus deferred ${parsed.taskId}: queued for owning window`);
  schedulePendingFocusWarning(parsed.taskId);
  return true;
}

async function processPendingFocusRequests() {
  if (processingPendingFocusRequests || !focusRequestStorePath) {
    return;
  }

  processingPendingFocusRequests = true;
  try {
    const requests = await readPendingFocusRequests(focusRequestStorePath);
    let changed = pruneExpiredPendingFocusRequests(requests);
    if (requests.size > 0) {
      appendCursorDebugLog("focus-queue-drain-start", {
        queuedTaskIds: Array.from(requests.keys())
      });
    }

    for (const request of Array.from(requests.values())) {
      const { terminal, source } = await resolveFocusedTerminal(
        request.taskId,
        request.cwd,
        request.monitorPid
      );
      if (!terminal) {
        appendCursorDebugLog("focus-queue-waiting", {
          taskId: request.taskId,
          cwd: request.cwd,
          monitorPid: request.monitorPid,
          windowRef: request.windowRef
        });
        continue;
      }

      await rememberTaskTerminal(request.taskId, terminal, request.cwd);
      const raisedWindow = await raiseCursorWindow(request.windowRef);
      appendCursorDebugLog("focus-queue-processed", {
        taskId: request.taskId,
        source: `shared-${source}`,
        terminal: await describeTerminal(terminal),
        cwd: request.cwd,
        monitorPid: request.monitorPid,
        windowRef: request.windowRef,
        raisedWindow
      });
      getOutputChannel().appendLine(`focus ${request.taskId} -> ${terminal.name} [shared-${source}]`);
      if (request.windowRef) {
        getOutputChannel().appendLine(
          `raise ${request.taskId} [shared] -> ${raisedWindow ? "ok" : "miss"}`
        );
      }
      const { focusIndexCommand } = await revealTerminal(
        terminal,
        vscode.window.terminals,
        (command) => vscode.commands.executeCommand(command),
        () => vscode.window.activeTerminal
      );
      let activatedCursorApp = false;
      if (!raisedWindow) {
        activatedCursorApp = await activateCursorApp();
        getOutputChannel().appendLine(
          `activate ${request.taskId} [shared] -> ${activatedCursorApp ? "ok" : "miss"}`
        );
      }
      appendCursorDebugLog("focus-queue-post-reveal", {
        taskId: request.taskId,
        source: `shared-${source}`,
        focusIndexCommand,
        raisedWindow,
        activatedCursorApp
      });
      if (focusIndexCommand) {
        getOutputChannel().appendLine(`terminal select ${request.taskId} [shared] -> ${focusIndexCommand}`);
      }
      requests.delete(request.taskId);
      changed = true;
    }

    if (changed) {
      await writePendingFocusRequests(focusRequestStorePath, requests);
    }
  } catch (error) {
    getOutputChannel().appendLine(`pending focus error: ${String(error)}`);
  } finally {
    processingPendingFocusRequests = false;
  }
}

async function focusTerminal(parsed) {
  const output = getOutputChannel();
  const { terminal, source } = await resolveFocusedTerminal(
    parsed.taskId,
    parsed.cwd,
    parsed.monitorPid
  );
  if (!terminal) {
    if (await deferFocusToOwningWindow(parsed, output)) {
      return;
    }

    appendCursorDebugLog("focus-miss", {
      taskId: parsed.taskId,
      cwd: parsed.cwd,
      monitorPid: parsed.monitorPid,
      windowRef: parsed.windowRef
    });
    output.appendLine(`focus miss ${parsed.taskId}: registry/process/cwd all failed`);
    await vscode.commands.executeCommand("workbench.action.terminal.focus");
    vscode.window.showWarningMessage(
      `未找到任务 ${parsed.taskId.slice(0, 8)} 对应的终端，已切到终端面板。`
    );
    return;
  }

  await rememberTaskTerminal(parsed.taskId, terminal, parsed.cwd);
  const raisedWindow = await raiseCursorWindow(parsed.windowRef);
  appendCursorDebugLog("focus-resolved", {
    taskId: parsed.taskId,
    source,
    terminal: await describeTerminal(terminal),
    cwd: parsed.cwd,
    monitorPid: parsed.monitorPid,
    windowRef: parsed.windowRef,
    raisedWindow
  });
  output.appendLine(`focus ${parsed.taskId} -> ${terminal.name} [${source}]`);
  if (parsed.windowRef) {
    output.appendLine(`raise ${parsed.taskId} -> ${raisedWindow ? "ok" : "miss"}`);
  }
  const { focusIndexCommand } = await revealTerminal(
    terminal,
    vscode.window.terminals,
    (command) => vscode.commands.executeCommand(command),
    () => vscode.window.activeTerminal
  );
  let activatedCursorApp = false;
  if (!raisedWindow) {
    activatedCursorApp = await activateCursorApp();
    output.appendLine(`activate ${parsed.taskId} -> ${activatedCursorApp ? "ok" : "miss"}`);
  }
  appendCursorDebugLog("focus-post-reveal", {
    taskId: parsed.taskId,
    source,
    focusIndexCommand,
    raisedWindow,
    activatedCursorApp
  });
  if (focusIndexCommand) {
    output.appendLine(`terminal select ${parsed.taskId} -> ${focusIndexCommand}`);
  }
}

async function routeFocusToWorkspace(parsed, output) {
  const currentWorkspace = getCurrentWorkspaceName();
  const targetWorkspace = extractWorkspaceFromWindowRef(parsed.windowRef);

  if (!shouldRouteFocusRequest(parsed, currentWorkspace)) {
    return false;
  }

  const reroutedUri = buildWorkspaceRouteFocusUri(parsed);
  if (!reroutedUri) {
    appendCursorDebugLog("focus-route-workspace-skipped", {
      taskId: parsed.taskId,
      currentWorkspace,
      targetWorkspace,
      reason: "missing-reroute-uri"
    });
    return false;
  }

  try {
    const routed = await vscode.commands.executeCommand(
      "deeplink.routeToWorkspaceName",
      targetWorkspace,
      reroutedUri
    );
    appendCursorDebugLog("focus-route-workspace-result", {
      taskId: parsed.taskId,
      currentWorkspace,
      targetWorkspace,
      focusAttempt: parsed.focusAttempt,
      routed: Boolean(routed)
    });

    if (routed) {
      output.appendLine(
        `focus rerouted ${parsed.taskId} -> ${targetWorkspace} [attempt=${parsed.focusAttempt + 1}]`
      );
    }

    return Boolean(routed);
  } catch (error) {
    appendCursorDebugLog("focus-route-workspace-error", {
      taskId: parsed.taskId,
      currentWorkspace,
      targetWorkspace,
      focusAttempt: parsed.focusAttempt,
      error: String(error)
    });
    output.appendLine(`focus reroute ${parsed.taskId} failed: ${String(error)}`);
    return false;
  }
}

async function handleUri(uri) {
  const parsed = parseMonitorUri(uri);
  if (!parsed?.taskId) {
    return;
  }

  const output = getOutputChannel();
  appendCursorDebugLog("uri-received", {
    action: parsed.action,
    taskId: parsed.taskId,
    cwd: parsed.cwd,
    monitorPid: parsed.monitorPid,
    windowRef: parsed.windowRef,
    focusAttempt: parsed.focusAttempt,
    activeTerminal: await describeTerminal(vscode.window.activeTerminal),
    terminalCount: vscode.window.terminals.length
  });

  if (parsed.action === "focus" && await routeFocusToWorkspace(parsed, output)) {
    return;
  }

  if (parsed.action === "register") {
    let source = "process-ancestry";
    let terminal = await resolveTerminalByMonitorPid(
      vscode.window.terminals,
      parsed.monitorPid
    );
    if (!terminal) {
      source = "cwd";
      terminal = resolveTerminalByCwd(vscode.window.terminals, parsed.cwd);
    }
    if (!terminal) {
      source = "active";
      terminal = vscode.window.activeTerminal;
    }

    if (!terminal) {
      output.appendLine(`skip register ${parsed.taskId}: no active terminal`);
      appendCursorDebugLog("register-skipped", {
        taskId: parsed.taskId,
        cwd: parsed.cwd,
        monitorPid: parsed.monitorPid,
        reason: "no-active-terminal"
      });
      return;
    }

    await rememberTaskTerminal(parsed.taskId, terminal, parsed.cwd);
    const processId = await getTerminalProcessId(terminal);
    appendCursorDebugLog("register-resolved", {
      taskId: parsed.taskId,
      source,
      cwd: parsed.cwd,
      monitorPid: parsed.monitorPid,
      terminal: await describeTerminal(terminal)
    });
    output.appendLine(
      `register ${parsed.taskId} -> ${terminal.name} [${source}${processId ? ` pid=${processId}` : ""}]`
    );
    void processPendingFocusRequests();
    return;
  }

  await focusTerminal(parsed);
}

function activate(context) {
  extensionContext = context;
  taskStateRegistry = loadTaskStateRegistry(context);
  focusRequestStorePath = getPendingFocusRequestStorePath(context.globalStorageUri?.fsPath ?? null);
  appendCursorDebugLog("extension-activated", {
    focusRequestStorePath,
    globalStoragePath: context.globalStorageUri?.fsPath ?? null
  });
  context.subscriptions.push(getOutputChannel());
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri
    })
  );
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((terminal) => {
      forgetTerminal(taskRegistry, terminal);
      void forgetPersistedTerminal(terminal);
    })
  );
  focusRequestPollTimer = setInterval(() => {
    void processPendingFocusRequests();
  }, PENDING_FOCUS_POLL_INTERVAL_MS);
  context.subscriptions.push({
    dispose() {
      if (focusRequestPollTimer) {
        clearInterval(focusRequestPollTimer);
        focusRequestPollTimer = null;
      }

      for (const timeout of pendingFocusWarningTimers.values()) {
        clearTimeout(timeout);
      }
      pendingFocusWarningTimers.clear();
    }
  });
}

function deactivate() {
  taskRegistry.clear();
  taskStateRegistry.clear();
  if (focusRequestPollTimer) {
    clearInterval(focusRequestPollTimer);
    focusRequestPollTimer = null;
  }
  for (const timeout of pendingFocusWarningTimers.values()) {
    clearTimeout(timeout);
  }
  pendingFocusWarningTimers.clear();
  focusRequestStorePath = null;
  extensionContext = null;
}

module.exports = {
  activate,
  deactivate
};
