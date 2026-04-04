const vscode = require("vscode");
const { forgetTerminal, resolveTerminal } = require("./lib/registry");
const { parseMonitorUri } = require("./lib/uri");

const taskRegistry = new Map();

function getOutputChannel() {
  if (!getOutputChannel.channel) {
    getOutputChannel.channel = vscode.window.createOutputChannel("Monitor Cursor Bridge");
  }

  return getOutputChannel.channel;
}

async function focusTerminal(taskId) {
  const terminal = resolveTerminal(taskRegistry, taskId, vscode.window.terminals);
  if (!terminal) {
    await vscode.commands.executeCommand("workbench.action.terminal.focus");
    vscode.window.showWarningMessage(
      `未找到任务 ${taskId.slice(0, 8)} 对应的终端，已切到终端面板。`
    );
    return;
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
    const terminal = vscode.window.activeTerminal;
    if (!terminal) {
      output.appendLine(`skip register ${parsed.taskId}: no active terminal`);
      return;
    }

    taskRegistry.set(parsed.taskId, terminal);
    output.appendLine(`register ${parsed.taskId} -> ${terminal.name}`);
    return;
  }

  output.appendLine(`focus ${parsed.taskId}`);
  await focusTerminal(parsed.taskId);
}

function activate(context) {
  context.subscriptions.push(getOutputChannel());
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri
    })
  );
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((terminal) => {
      forgetTerminal(taskRegistry, terminal);
    })
  );
}

function deactivate() {
  taskRegistry.clear();
}

module.exports = {
  activate,
  deactivate
};
