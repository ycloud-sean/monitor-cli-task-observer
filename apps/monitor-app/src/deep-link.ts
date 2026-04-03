export function parseTaskUrl(url: string): { taskId: string } | null {
  const match = /^monitor:\/\/task\/(.+)$/.exec(url);
  if (!match) {
    return null;
  }

  return { taskId: match[1] };
}
