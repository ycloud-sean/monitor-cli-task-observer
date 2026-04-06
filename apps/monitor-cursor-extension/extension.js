const vscode = require("vscode");
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
const { raiseCursorWindow } = require("./lib/window-focus");
const { parseMonitorUri } = require("./lib/uri");

const TASK_STATE_KEY = "monitor.cursor.task-state.v1";
const PENDING_FOCUS_POLL_INTERVAL_MS = 250;
const PENDING_FOCUS_WARNING_DELAY_MS = 1500;
const taskRegistry = new Map();
let taskStateRegistry = new Map();
let extensionContext = null;
let focusRequestStorePath = null;
let focusRequestPollTimer = null;
let processingPendingFocusRequests = false;
const pendingFocusWarningTimers = new Map();

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
    return false;
  }

  const requests = await readPendingFocusRequests(focusRequestStorePath);
  if (!enqueuePendingFocusRequest(requests, parsed)) {
    return false;
  }

  await writePendingFocusRequests(focusRequestStorePath, requests);
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

    for (const request of Array.from(requests.values())) {
      const { terminal, source } = await resolveFocusedTerminal(
        request.taskId,
        request.cwd,
        request.monitorPid
      );
      if (!terminal) {
        continue;
      }

      await rememberTaskTerminal(request.taskId, terminal, request.cwd);
      const raisedWindow = await raiseCursorWindow(request.windowRef);
      getOutputChannel().appendLine(`focus ${request.taskId} -> ${terminal.name} [shared-${source}]`);
      if (request.windowRef) {
        getOutputChannel().appendLine(
          `raise ${request.taskId} [shared] -> ${raisedWindow ? "ok" : "miss"}`
        );
      }
      terminal.show(false);
      await vscode.commands.executeCommand("workbench.action.terminal.focus");
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

    output.appendLine(`focus miss ${parsed.taskId}: registry/process/cwd all failed`);
    await vscode.commands.executeCommand("workbench.action.terminal.focus");
    vscode.window.showWarningMessage(
      `未找到任务 ${parsed.taskId.slice(0, 8)} 对应的终端，已切到终端面板。`
    );
    return;
  }

  await rememberTaskTerminal(parsed.taskId, terminal, parsed.cwd);
  const raisedWindow = await raiseCursorWindow(parsed.windowRef);
  output.appendLine(`focus ${parsed.taskId} -> ${terminal.name} [${source}]`);
  if (parsed.windowRef) {
    output.appendLine(`raise ${parsed.taskId} -> ${raisedWindow ? "ok" : "miss"}`);
  }
  terminal.show(false);
  await vscode.commands.executeCommand("workbench.action.terminal.focus");
}

async function handleUri(uri) {
  const parsed = parseMonitorUri(uri);
  if (!parsed?.taskId) {
    return;
  }

  const output = getOutputChannel();
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
      return;
    }

    await rememberTaskTerminal(parsed.taskId, terminal, parsed.cwd);
    const processId = await getTerminalProcessId(terminal);
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
