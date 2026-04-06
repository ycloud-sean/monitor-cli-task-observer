function parseMonitorUri(uri) {
  const path = typeof uri?.path === "string" ? uri.path : "";
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  const action = normalizedPath === "register" || normalizedPath === "focus"
    ? normalizedPath
    : null;

  if (!action) {
    return null;
  }

  const params = new URLSearchParams(typeof uri?.query === "string" ? uri.query : "");
  const focusAttempt = Number.parseInt(params.get("focusAttempt") ?? "", 10);
  return {
    action,
    taskId: params.get("taskId"),
    name: params.get("name"),
    cwd: params.get("cwd"),
    monitorPid: params.get("monitorPid"),
    windowRef: params.get("windowRef"),
    focusAttempt: Number.isInteger(focusAttempt) && focusAttempt >= 0 ? focusAttempt : 0
  };
}

module.exports = {
  parseMonitorUri
};
