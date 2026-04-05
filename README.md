# Monitor CLI Task Observer

macOS 上给 `codex` / `claude` CLI 做任务监控、等待输入提醒、点击回跳和 Cursor 精确终端聚焦的一套本地方案。

## 安装与升级

当前项目提供两种安装方式：

- 推荐：Homebrew，适合大多数用户
- 备选：`curl` 安装脚本，适合不想用 Homebrew、或者希望直接在本地拉源码构建的人

### 1. 环境要求

- `macOS arm64`
- 已安装 `codex` 或 `claude`
- 如果要支持 Cursor 精确跳回终端，需要安装 Cursor
- 如果走 Homebrew 安装，要求 `node` 已在 `PATH` 中，且版本为 `Node.js 22.x`
- 如果走 `curl` 安装，要求本机已有 `git`、`node`、`npm`；建议同样使用 `Node.js 22.x`

### 2. 推荐：Homebrew 安装

安装：

```bash
HOMEBREW_NO_AUTO_UPDATE=1 brew install ycloud-sean/monitor/monitor
```

升级：

```bash
HOMEBREW_NO_AUTO_UPDATE=1 brew upgrade ycloud-sean/monitor/monitor
```

卸载：

```bash
brew uninstall monitor
```

如果还想把本地任务数据和 Cursor bridge 一并清掉，再额外执行：

```bash
rm -rf ~/.monitor-data
rm -rf ~/.cursor/extensions/liangxin.monitor-cursor-bridge-0.1.0
```

说明：

- Homebrew 的 tap 仓库只保留很小的 formula 和文档，真正的 runtime 包会在安装阶段单独下载
- Homebrew 包安装的是预构建运行包，不会在用户机器上再执行一次 `npm install + tsc`
- `HOMEBREW_NO_AUTO_UPDATE=1` 用来避免长时间卡在 `==> Auto-updating Homebrew...`
- 不建议额外加 `HOMEBREW_NO_INSTALL_FROM_API=1`；在 Homebrew 5 下，它可能触发 `homebrew/core` 的首次 clone，反而更慢
- 当前 Homebrew 分发方案只支持 `macOS arm64`
- Homebrew 包会直接复用用户本机的 `node`
- 当前为了兼容 `better-sqlite3`，运行时要求 `Node.js 22.x`，不建议使用 `23+`
- Homebrew 会把 `monitor` 和 `monitord` 放进自己的 `bin`，正常情况下不需要再手动 `source ~/.zshrc`
- 如果你之前装过旧的 `curl` 版本，`monitor 1.0.6+` 在第一次运行时会自动替换掉旧 daemon，不需要手动清理后台进程

### 3. 备选：curl 安装脚本

安装：

```bash
curl -fsSL https://raw.githubusercontent.com/ycloud-sean/monitor-cli-task-observer/main/scripts/install.sh | bash
```

升级：

```bash
curl -fsSL https://raw.githubusercontent.com/ycloud-sean/monitor-cli-task-observer/main/scripts/install.sh | bash
```

说明：

- `curl` 安装脚本会自动判断本地是否已存在 `~/.monitor/monitor-cli-task-observer`
- 如果已存在，会执行更新；如果不存在，会执行首次安装
- 所以 `curl` 方式的升级命令和安装命令是同一条

安装脚本会自动完成这些事情：

- 克隆或更新仓库到 `~/.monitor/monitor-cli-task-observer`
- 安装并构建 `@monitor/contracts`、`@monitor/cli`、`monitor-cursor-bridge`
- 在 `~/.local/bin` 下生成 `monitor` 和 `monitord` 命令
- 自动把 Cursor bridge 扩展复制到 `~/.cursor/extensions/liangxin.monitor-cursor-bridge-0.1.0`
- 如果 shell 配置文件里还没有 `export PATH="$HOME/.local/bin:$PATH"`，会自动追加一次；重复安装不会重复追加

如果你的 shell 还没有把 `~/.local/bin` 加进当前终端的 `PATH`，安装脚本会提示你执行：

```bash
source ~/.zshrc
```

或者直接开一个新终端。

卸载：

```bash
rm -f ~/.local/bin/monitor ~/.local/bin/monitord
rm -rf ~/.monitor/monitor-cli-task-observer
rm -rf ~/.monitor-data
rm -rf ~/.cursor/extensions/liangxin.monitor-cursor-bridge-0.1.0
```

如果你确认 `~/.local/bin` 这一行只是 `monitor` 安装脚本加的，也可以再手动从 `~/.zshrc`、`~/.bashrc` 或 `~/.bash_profile` 里删掉：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

### 4. Cursor bridge

- Homebrew 安装：第一次在 Cursor 里执行 `monitor codex` 或 `monitor claude` 时，`monitor` 会自动补装 Cursor bridge
- `curl` 安装：安装脚本会直接安装 Cursor bridge
- 两种方式都可以手动重装：

```bash
monitor install-cursor-bridge
```

如果补装或重装时 Cursor 已经在运行，重启一次 Cursor，确保 bridge 被加载。

### 5. 开发态构建

如果你是在仓库里本地开发，而不是从 GitHub 安装，再执行：

```bash
npm install
npm run build:installable
```

如果你是在开发态手动安装 Cursor bridge，直接用本地扩展目录复制：

```bash
cp -R apps/monitor-cursor-extension \
  ~/.cursor/extensions/liangxin.monitor-cursor-bridge-0.1.0
```

安装后把 Cursor 重启一次，确保扩展被加载。

### 6. 启动监控任务

安装完成后，直接执行：

```bash
monitor codex
```

或者：

```bash
monitor claude
```

第一次运行时，如果本地 daemon 还没启动，`monitor` 会自动在后台拉起它，然后继续执行你的任务。

只有在调试 daemon 本身时，才需要手动启动：

```bash
node apps/monitor-cli/dist/bin/monitord.js
```

### 7. 安装后验证

- 在 Cursor 终端里启动一个新任务：`monitor codex`
- 等它进入 `waiting_input` 或 `waiting_approval`
- 点击弹窗里的“打开任务”
- 预期结果：
  - 正确的 Cursor 窗口被拉到前台
  - 正确的终端 session 被直接显示并获得焦点

## 如何安装使用

### 1. 授权

第一次使用前，系统里要给相关应用开权限：

- `Cursor` / `Terminal` / `iTerm2` 需要允许辅助功能
- `osascript` 触发的自动化操作需要允许控制相关应用

如果没开，通知可能能弹出来，但“打开任务”不会生效。

### 2. 启动监控任务

安装完成后，直接执行：

```bash
monitor codex
```

或者：

```bash
monitor claude
```

也可以手动指定名字：

```bash
monitor codex --name api-fix
```

不传 `--name` 时，会自动生成唯一任务 ID，不需要手动命名。

### 额外说明

- 安装、升级、卸载命令见上面的“安装与升级”。
- 当前对外可用的安装入口有两种：Homebrew 和 GitHub 安装脚本。
- 如果你是从旧 `curl` 安装切换到 Homebrew，`monitor 1.0.6+` 会自动替换旧 daemon。

### 3. 使用方式

- 正常输出时，`monitor` 会持续转发 CLI 输出
- 当任务进入等待输入或等待审批时，会弹出中文对话框
- 点击“打开任务”后：
  - `Terminal.app` / `iTerm2` 会按 tty 精确切回原会话
  - `Cursor` 会先切回正确窗口，再切到对应终端

### 4. 常用命令

查看当前任务：

```bash
curl -s http://127.0.0.1:45731/tasks
```

手动聚焦某个任务：

```bash
curl -s -X POST http://127.0.0.1:45731/tasks/<taskId>/focus
```

## 如何实现的

整体分成三层：

### 1. `monitor` 包装层

`monitor` 不是直接替代 `codex` / `claude`，而是包一层启动器。

它负责：

- 启动真实 CLI 进程
- 用 PTY 包装进程，避免 `codex` 因为没有终端能力而异常
- 采集 stdout / stderr
- 把任务启动、输出、结束、等待输入、等待审批这些事件发给本地 daemon

对应实现主要在：

- [apps/monitor-cli/src/bin/monitor.ts](apps/monitor-cli/src/bin/monitor.ts)
- [apps/monitor-cli/src/lib/adapters/codex.ts](apps/monitor-cli/src/lib/adapters/codex.ts)

### 2. daemon 状态机与通知层

本地 daemon 负责维护任务注册表，并根据状态变化触发通知。

它负责：

- 接收 `task.started` / `task.output` / `task.waiting_input` / `task.waiting_approval` / `task.finished` / `task.error`
- 把最新任务状态持久化到本地 sqlite
- 在任务进入等待态时弹出中文对话框
- 在用户点击“打开任务”时，调用对应宿主的聚焦脚本

对应实现主要在：

- [apps/monitor-cli/src/lib/server.ts](apps/monitor-cli/src/lib/server.ts)
- [apps/monitor-cli/src/lib/state-machine.ts](apps/monitor-cli/src/lib/state-machine.ts)
- [apps/monitor-cli/src/lib/notification.ts](apps/monitor-cli/src/lib/notification.ts)

### 3. 宿主聚焦层

不同终端宿主，聚焦策略不一样：

- `Terminal.app` / `iTerm2`
  - 启动任务时记录 tty
  - 回跳时按 tty 找回准确 tab / session

- `Cursor`
  - 先记录窗口快照，用来把正确的 Cursor 窗口拉到前台
  - 但 macOS 外部脚本拿不到稳定的 Cursor 终端 session 标识
  - 所以额外加了一个 Cursor 内部扩展做桥接

对应实现主要在：

- [apps/monitor-cli/src/lib/host-metadata.ts](apps/monitor-cli/src/lib/host-metadata.ts)
- [apps/monitor-cli/src/lib/focus/router.ts](apps/monitor-cli/src/lib/focus/router.ts)
- [apps/monitor-cli/src/lib/focus/cursor.ts](apps/monitor-cli/src/lib/focus/cursor.ts)
- [apps/monitor-cursor-extension/extension.js](apps/monitor-cursor-extension/extension.js)

## 原理

### 1. 为什么 Terminal / iTerm2 容易做

这两个宿主都能从外部稳定拿到 tty，所以只要任务启动时记下 tty，回跳时就能直接定位到原终端。

### 2. 为什么 Cursor 不能只靠 AppleScript

Cursor 的窗口可以通过无障碍 API 大致匹配回来，但“到底是哪一个终端 session”这一层，外部脚本拿不到稳定、可复用的 session ID。也就是说：

- 可以拉回正确窗口
- 但不能只靠外部脚本稳定进入正确终端

这也是最开始只能“回到 Cursor 窗口”，却进不到对应终端的根因。

### 3. Cursor bridge 怎么解决这个问题

现在的做法是把“终端映射”放到 Cursor 内部完成：

1. `monitor` 启动任务时，向 Cursor 打一个 `cursor://.../register?taskId=...` URI
2. Cursor bridge 扩展收到后，把当前 `activeTerminal` 记成这个 `taskId` 对应的终端
3. 之后用户点击“打开任务”时
4. daemon 先把正确 Cursor 窗口拉到前台
5. 再打开 `cursor://.../focus?taskId=...`
6. Cursor bridge 在扩展内部查表，直接对对应 terminal 调 `show(false)` 并聚焦终端面板

所以 Cursor 这条链路现在不是“猜 UI”，而是：

- 外部只负责拉回正确窗口
- 内部扩展负责切到正确终端

这也是为什么现在 Cursor 已经可以稳定跑通，而不是停留在 best-effort 的窗口激活。
