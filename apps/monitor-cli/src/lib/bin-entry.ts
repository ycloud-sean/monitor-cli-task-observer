import { realpathSync } from "node:fs";
import { resolve } from "node:path";

export function isDirectExecution(
  modulePath: string,
  argv1: string | undefined,
  realpath: (path: string) => string = realpathSync.native
): boolean {
  if (!argv1) {
    return false;
  }

  try {
    return realpath(modulePath) === realpath(resolve(argv1));
  } catch {
    return modulePath === resolve(argv1);
  }
}
