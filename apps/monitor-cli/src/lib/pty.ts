export function wrapCommandWithPty(command: string[]): string[] {
  if (command.length === 0) {
    throw new Error("command must not be empty");
  }

  return ["script", "-q", "/dev/null", ...command];
}
