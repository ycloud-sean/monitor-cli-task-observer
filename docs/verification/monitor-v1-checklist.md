# Monitor V1 Verification Checklist

- [ ] `monitord` starts and serves `GET /tasks`
- [ ] `monitor codex --name api-fix` creates a running task
- [ ] `monitor claude --name auth-debug` creates a running task
- [ ] The menu bar window shows correct `Active` and `Alerts` counters
- [ ] Codex completion creates a finished notification
- [ ] Claude Notification hook creates a waiting task
- [ ] Claude Stop hook creates a finished task
- [ ] Clicking a notification opens the app with the matching task selected
- [ ] The selected task detail shows command, cwd, and recent output
- [ ] Clicking `Focus task` focuses Terminal.app for terminal-hosted tasks
- [ ] Clicking `Focus task` focuses iTerm2 for iTerm-hosted tasks
- [ ] Clicking `Focus task` activates Cursor for cursor-hosted tasks
- [ ] If focus fails, the task remains visible in the detail view and the `Focus task` button remains usable
