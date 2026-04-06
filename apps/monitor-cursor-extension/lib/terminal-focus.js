function getTerminalFocusIndexCommand(terminals, terminal) {
  const terminalIndex = terminals.indexOf(terminal);
  if (terminalIndex < 0 || terminalIndex > 8) {
    return null;
  }

  return `workbench.action.terminal.focusAtIndex${terminalIndex + 1}`;
}

async function revealTerminal(
  terminal,
  terminals,
  executeCommand,
  activeTerminalProvider = () => undefined
) {
  terminal.show(false);

  const focusIndexCommand = getTerminalFocusIndexCommand(terminals, terminal);
  if (focusIndexCommand) {
    await executeCommand(focusIndexCommand);
  }

  if (activeTerminalProvider() !== terminal) {
    terminal.show(false);
  }

  await executeCommand("workbench.action.terminal.focus");

  return {
    focusIndexCommand
  };
}

module.exports = {
  getTerminalFocusIndexCommand,
  revealTerminal
};
