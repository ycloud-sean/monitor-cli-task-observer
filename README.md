# Monitor CLI Task Observer

macOS task monitoring for `codex` and `claude` CLI sessions, with a local daemon,
clickable notifications, and a menu bar UI for inspecting and refocusing tasks.

## Development

1. `npm install`
2. `npm run -w @monitor/cli build`
3. `node apps/monitor-cli/dist/bin/monitord.js`
4. `npm run -w monitor-app tauri dev`
5. `node apps/monitor-cli/dist/bin/monitor.js codex --name api-fix`
6. `node apps/monitor-cli/dist/bin/monitor.js claude --name auth-debug`

## Notes

- v1 is macOS only.
- Focus-back needs Automation and Accessibility permissions.
- Cursor focus is best-effort and currently activates the Cursor window.
- Exact terminal tab/session focus is only attempted for supported hosts with captured metadata.
