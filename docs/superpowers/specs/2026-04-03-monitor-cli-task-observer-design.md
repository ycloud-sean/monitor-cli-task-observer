# Monitor CLI Task Observer Design

Date: 2026-04-03
Platform scope: macOS only for v1
Status: Draft for review

## Goal

Build a local monitoring system for CLI agent tasks started through a unified `monitor` launcher so the user can:

- get notified when a task finishes
- get notified when a task is waiting for input or approval
- quickly return to the original task from the notification
- manage tasks started from `Terminal.app`, `iTerm2`, or `Cursor` terminal without opening many separate terminal windows

The system is explicitly designed around `monitor codex ...` and `monitor claude ...` rather than passive global monitoring of all terminal processes.

## Non-Goals

These items are out of scope for v1:

- monitoring tasks that were not started through `monitor`
- controlling approval actions directly inside the app
- supporting Cursor's foreground Agent UI button flows
- cross-platform support
- a full desktop dashboard
- advanced history, search, grouping, tagging, or analytics

## Recommended Approach

Use a three-part architecture:

1. `monitor` command as the only supported launch entrypoint
2. local `monitord` daemon as the source of truth for tasks and task state
3. macOS menu bar app for notifications, task list, and fallback task detail view

This is preferred over a shell-only wrapper because notification-to-task resolution needs stable task identity and local state. It is preferred over passive global terminal monitoring because passive monitoring is fragile across `Terminal.app`, `iTerm2`, and `Cursor`.

## User Experience

### Launch

The user starts tasks through:

```bash
monitor codex --name api-fix
monitor claude --name auth-debug
```

The launcher starts the real CLI, forwards stdin/stdout/stderr, and registers task metadata with the local daemon.

### Notify

When the task changes into a notable state, the system sends a macOS notification. Important v1 states are:

- `waiting_input`
- `waiting_approval`
- `finished`
- `error`

Notification text includes the task name and state, for example:

- `api-fix needs approval`
- `auth-debug finished`

### Return To Task

When the user clicks the notification:

1. resolve the `task_id`
2. look up the task in the daemon
3. activate the host application
4. try to focus the original terminal window/tab/session
5. if focus fails, open the app's task detail window instead

The detail window acts as a reliable fallback instead of allowing the notification click to fail silently.

## Architecture

### Component Overview

#### `monitor` launcher

Responsibilities:

- parse the requested runner and arguments
- start the real CLI process
- capture task metadata such as task name, cwd, pid, host app, and launch time
- forward IO so the terminal experience remains normal
- emit normalized events to the daemon

#### `monitord` daemon

Responsibilities:

- own the task registry
- own the task state machine
- accept events from launchers and CLI-specific integrations
- trigger notifications
- expose local APIs to the menu bar app

#### macOS menu bar app

Responsibilities:

- show active task count and unread alert count
- show a compact task list
- show a task detail window
- handle notification click routing
- attempt focus-back to the original task

### Why This Split

This split keeps process execution separate from UI concerns. The launcher stays close to terminal behavior. The daemon handles state and policy. The menu bar app handles presentation and user navigation. This reduces coupling and makes it easier to add more monitored CLIs later.

## Task Model

Each monitored task has a stable `task_id` and stores:

- `task_id`
- `name`
- `runner_type`
- `raw_command`
- `cwd`
- `pid`
- `host_app`
- `host_window_ref`
- `host_tab_ref` or `session_ref`
- `started_at`
- `last_event_at`
- `status`
- `last_output_excerpt`

This model is intentionally narrow. It supports notification, resolution, and fallback display without requiring broad terminal introspection.

## State Model

V1 uses only five task states:

- `running`
- `waiting_input`
- `waiting_approval`
- `finished`
- `error`

### State Transitions

- new task starts in `running`
- prompt or interaction wait moves to `waiting_input`
- permission confirmation wait moves to `waiting_approval`
- successful completion moves to `finished`
- abnormal termination or failure moves to `error`
- resumed output from a waiting state moves back to `running`

This is enough to drive alerts and filtering without creating adapter-specific state sprawl.

## CLI Integrations

### Claude

Claude integration uses official hooks as the primary signal source.

- `Notification` hook maps to `waiting_input` or `waiting_approval`
- `Stop` hook maps to `finished`

`monitor claude` is responsible for injecting local task context and converting hook output into normalized daemon events.

### Codex

Codex integration uses official `notify` for completion-oriented events and wrapper-assisted output observation for waiting states.

- `notify` is the primary source for `finished`
- output and interaction pattern detection is used for `waiting_input`
- output and interaction pattern detection is used for `waiting_approval`

Codex support is intentionally adapter-driven because its official signaling coverage is not the same as Claude's.

### Unified Event Types

All integrations normalize into the same event vocabulary:

- `task.started`
- `task.output`
- `task.waiting_input`
- `task.waiting_approval`
- `task.finished`
- `task.error`

This keeps the daemon simple and prevents CLI-specific branching from spreading through the whole system.

## Focus Resolution

### Primary Strategy

Notification click handling follows this priority:

1. activate the host app
2. resolve the original terminal window/tab/session
3. focus it
4. if any step fails, open the app's task detail window

### Host-Specific Handling

#### Terminal.app

Use AppleScript or Automation APIs to activate the correct window and tab.

#### iTerm2

Use AppleScript or Automation APIs to activate the correct window, tab, or session.

#### Cursor terminal

V1 guarantees activation of the Cursor window first. Precise terminal task focus is best-effort because Cursor terminal targeting is more dependent on UI structure and accessibility behavior. If exact targeting is unreliable, the fallback task detail window remains the stable path.

### Permissions

The app may require macOS Automation and Accessibility permissions for reliable focus behavior. V1 assumes the user accepts these permissions.

## UI Scope

### Required UI

V1 includes:

- menu bar drop-down
- system notifications
- per-task detail window

### Menu Bar Contents

Each task row shows:

- task name
- runner type
- current state
- last updated time

### Task Detail Window

The detail window shows:

- task name
- current status
- original command
- cwd
- recent output
- a button to retry focus-back to the original task

### Excluded UI

V1 excludes:

- a full main app window
- advanced history browser
- task editing
- task grouping
- search
- approval buttons

## Local Data And IPC

### IPC

The launcher sends events to the daemon through a local-only transport. Suitable options are:

- Unix socket
- loopback HTTP API

Recommendation: use a local transport that does not depend on external services and is easy for both launcher and menu bar app to consume.

### Persistence

Use in-memory state for the live registry plus lightweight local persistence for recent tasks. This supports app or daemon restarts without introducing a heavy storage dependency.

Recommendation: use SQLite for recent task and event persistence because it keeps the design simple now and leaves room for later query needs.

## Technical Direction

### Runtime Choices

#### Launcher and daemon

Use `Node.js + TypeScript`.

Reasons:

- strong fit for process spawning and IO forwarding
- straightforward CLI packaging
- easy event handling and JSON serialization

#### Menu bar app

Use `Tauri + TypeScript`.

Reasons:

- efficient macOS menu bar and lightweight window support
- faster delivery than a fully native app for this scope
- can bridge to AppleScript or small Rust helpers for focus logic

## Delivery Order

Build in this order:

1. `monitor codex` minimal end-to-end path
2. daemon task registry and state transitions
3. menu bar app task list and notifications
4. notification click to detail window fallback
5. terminal focus-back for `Terminal.app` and `iTerm2`
6. `monitor claude` integration
7. Cursor window activation, then best-effort Cursor terminal targeting

This sequence reduces risk. It gets the launcher-daemon-UI loop working before the most brittle part, which is host-specific focus targeting.

## Risks And Constraints

### Cursor targeting

Precise Cursor terminal focus may be unstable because it depends on external UI structure and accessibility behavior. V1 should treat Cursor exact targeting as best-effort and rely on the detail window as the guaranteed fallback.

### Signal quality for waiting states

Claude waiting states have stronger official integration support than Codex. Codex waiting-state detection may need refinement over time as more real output patterns are observed.

### Permission setup

Without Automation and Accessibility permissions, focus-back behavior may degrade. The app must surface this clearly when setup is incomplete.

## Success Criteria

V1 is successful when:

- the user can launch `codex` and `claude` through `monitor`
- task state changes appear in the menu bar app
- finish and waiting states trigger macOS notifications
- clicking a notification usually returns the user to the original task
- if task focus fails, the detail window always opens and shows enough context to recover the task manually

## Open Decisions Intentionally Deferred

These are left for implementation planning rather than design:

- exact CLI argument shape for `monitor`
- exact local IPC protocol details
- exact SQLite schema
- exact AppleScript implementations per host app
- whether the menu bar app and daemon ship as one bundle or separate processes
