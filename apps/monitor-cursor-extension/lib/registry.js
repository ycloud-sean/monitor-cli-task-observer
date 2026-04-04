function forgetTerminal(taskRegistry, terminal) {
  for (const [taskId, mappedTerminal] of taskRegistry.entries()) {
    if (mappedTerminal === terminal) {
      taskRegistry.delete(taskId);
    }
  }
}

function resolveTerminal(taskRegistry, taskId, terminals) {
  const terminal = taskRegistry.get(taskId);
  if (!terminal) {
    return null;
  }

  return terminals.includes(terminal) ? terminal : null;
}

module.exports = {
  forgetTerminal,
  resolveTerminal
};
