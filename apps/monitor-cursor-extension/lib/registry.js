const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

function forgetTerminal(taskRegistry, terminal) {
  for (const [taskId, mappedTerminal] of taskRegistry.entries()) {
    if (mappedTerminal === terminal) {
      taskRegistry.delete(taskId);
    }
  }
}

function normalizeCwd(cwd) {
  if (!cwd || typeof cwd !== "string") {
    return null;
  }

  if (cwd === "/") {
    return cwd;
  }

  return cwd.replace(/\/+$/, "");
}

function getTerminalCwd(terminal) {
  const cwd = terminal?.shellIntegration?.cwd;
  if (!cwd) {
    return null;
  }

  if (typeof cwd === "string") {
    return normalizeCwd(cwd);
  }

  if (typeof cwd.fsPath === "string" && cwd.fsPath) {
    return normalizeCwd(cwd.fsPath);
  }

  if (cwd.scheme === "file" && typeof cwd.path === "string" && cwd.path) {
    return normalizeCwd(decodeURIComponent(cwd.path));
  }

  return null;
}

function resolveTerminalByCwd(terminals, cwd) {
  const normalizedCwd = normalizeCwd(cwd);
  if (!normalizedCwd) {
    return null;
  }

  const matches = terminals.filter((terminal) => getTerminalCwd(terminal) === normalizedCwd);
  return matches.length === 1 ? matches[0] : null;
}

async function resolveTerminalByMonitorPid(terminals, monitorPid, execFileImpl = execFileAsync) {
  const normalizedPid = Number(monitorPid);
  if (!Number.isInteger(normalizedPid) || normalizedPid <= 0) {
    return null;
  }

  const ancestorPids = new Set();
  const visitedPids = new Set();
  let currentPid = normalizedPid;

  while (Number.isInteger(currentPid) && currentPid > 0 && !visitedPids.has(currentPid)) {
    ancestorPids.add(currentPid);
    visitedPids.add(currentPid);

    let stdout = "";
    try {
      const result = await execFileImpl("ps", ["-o", "ppid=", "-p", String(currentPid)]);
      stdout = typeof result === "string" ? result : result.stdout;
    } catch {
      break;
    }

    const parentPid = Number.parseInt(String(stdout).trim(), 10);
    if (!Number.isInteger(parentPid) || parentPid <= 0 || parentPid === currentPid) {
      break;
    }

    currentPid = parentPid;
  }

  const terminalsWithPids = await Promise.all(
    terminals.map(async (terminal) => ({
      terminal,
      processId: await Promise.resolve(terminal.processId).catch(() => undefined)
    }))
  );

  const matches = terminalsWithPids.filter(({ processId }) =>
    Number.isInteger(processId) ? ancestorPids.has(processId) : false
  );

  return matches.length === 1 ? matches[0].terminal : null;
}

function resolveTerminal(taskRegistry, taskId, terminals, cwd = null) {
  const terminal = taskRegistry.get(taskId);
  if (!terminal) {
    return resolveTerminalByCwd(terminals, cwd);
  }

  if (terminals.includes(terminal)) {
    return terminal;
  }

  return resolveTerminalByCwd(terminals, cwd);
}

module.exports = {
  forgetTerminal,
  resolveTerminal,
  resolveTerminalByCwd,
  resolveTerminalByMonitorPid
};
