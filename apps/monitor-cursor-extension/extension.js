const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
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
  buildFocusRerouteScript,
  shouldRerouteFocus
} = require("./lib/focus");
const { parseMonitorUri } = require("./lib/uri");

const TASK_STATE_KEY = "monitor.cursor.task-state.v1";
const execFileAsync = promisify(execFile);
const taskRegistry = new Map();
let taskStateRegistry = new Map();
let extensionContext = null;

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

async function rerouteFocus(parsed, output) {
  const script = buildFocusRerouteScript(parsed);
  if (!script) {
    return false;
  }

  try {
    await execFileAsync("osascript", ["-e", script]);
    output.appendLine(
      `focus reroute ${parsed.taskId} -> attempt ${(parsed.focusAttempt ?? 0) + 1}`
    );
    return true;
  } catch (error) {
    output.appendLine(`focus reroute failed ${parsed.taskId}: ${String(error)}`);
    return false;
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
    if (shouldRerouteFocus(parsed) && (await rerouteFocus(parsed, output))) {
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
  output.appendLine(`focus ${parsed.taskId} -> ${terminal.name} [${source}]`);
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
    return;
  }

  await focusTerminal(parsed);
}

function activate(context) {
  extensionContext = context;
  taskStateRegistry = loadTaskStateRegistry(context);
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
}

function deactivate() {
  taskRegistry.clear();
  taskStateRegistry.clear();
  extensionContext = null;
}

module.exports = {
  activate,
  deactivate
};
