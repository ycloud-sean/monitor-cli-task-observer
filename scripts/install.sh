#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${MONITOR_REPO_URL:-https://github.com/ycloud-sean/monitor-cli-task-observer.git}"
INSTALL_REF="${MONITOR_INSTALL_REF:-main}"
INSTALL_ROOT="${MONITOR_INSTALL_ROOT:-$HOME/.monitor/monitor-cli-task-observer}"
BIN_DIR="${MONITOR_BIN_DIR:-$HOME/.local/bin}"
CURSOR_EXTENSIONS_DIR="${MONITOR_CURSOR_EXTENSIONS_DIR:-$HOME/.cursor/extensions}"
CURSOR_EXTENSION_ID="liangxin.monitor-cursor-bridge-0.1.0"
CURSOR_EXTENSION_DIR="$CURSOR_EXTENSIONS_DIR/$CURSOR_EXTENSION_ID"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '缺少必需命令: %s\n' "$1" >&2
    exit 1
  fi
}

write_wrapper() {
  local target_path="$1"
  local entry_path="$2"

  cat >"$target_path" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec node "$entry_path" "\$@"
EOF
  chmod +x "$target_path"
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf '当前安装脚本只支持 macOS。\n' >&2
  exit 1
fi

require_command git
require_command node
require_command npm

mkdir -p "$BIN_DIR"
mkdir -p "$CURSOR_EXTENSIONS_DIR"
mkdir -p "$(dirname "$INSTALL_ROOT")"

if [[ -d "$INSTALL_ROOT/.git" ]]; then
  printf '更新安装目录: %s\n' "$INSTALL_ROOT"
  git -C "$INSTALL_ROOT" fetch --depth=1 origin "$INSTALL_REF"
  git -C "$INSTALL_ROOT" checkout --force FETCH_HEAD
else
  if [[ -e "$INSTALL_ROOT" ]]; then
    printf '安装目录已存在且不是 git 仓库: %s\n' "$INSTALL_ROOT" >&2
    exit 1
  fi

  printf '克隆仓库到: %s\n' "$INSTALL_ROOT"
  git clone --depth=1 --branch "$INSTALL_REF" "$REPO_URL" "$INSTALL_ROOT"
fi

printf '安装依赖并构建 CLI...\n'
(
  cd "$INSTALL_ROOT"
  npm install --workspace packages/contracts --workspace apps/monitor-cli --workspace apps/monitor-cursor-extension
  npm run -w @monitor/contracts build
  npm run -w @monitor/cli build
  npm run -w monitor-cursor-bridge build
)

write_wrapper "$BIN_DIR/monitor" "$INSTALL_ROOT/apps/monitor-cli/dist/bin/monitor.js"
write_wrapper "$BIN_DIR/monitord" "$INSTALL_ROOT/apps/monitor-cli/dist/bin/monitord.js"

if [[ -d "$CURSOR_EXTENSION_DIR" ]]; then
  rm -rf "$CURSOR_EXTENSION_DIR"
fi
cp -R "$INSTALL_ROOT/apps/monitor-cursor-extension" "$CURSOR_EXTENSION_DIR"

printf '\n安装完成。\n'
printf '命令入口:\n'
printf '  %s/monitor\n' "$BIN_DIR"
printf '  %s/monitord\n' "$BIN_DIR"
printf 'Cursor bridge 已安装到:\n'
printf '  %s\n' "$CURSOR_EXTENSION_DIR"

if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  printf '\n请把下面这行加入你的 shell 配置文件后重新打开终端:\n'
  printf '  export PATH="%s:$PATH"\n' "$BIN_DIR"
fi

printf '\n之后直接执行:\n'
printf '  monitor codex\n'
printf '\n如果 Cursor 正在运行，重启一次 Cursor，确保 bridge 扩展被加载。\n'
