#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${MONITOR_REPO_URL:-https://github.com/ycloud-sean/monitor-cli-task-observer.git}"
SSH_REPO_URL="${MONITOR_REPO_SSH_URL:-git@github.com:ycloud-sean/monitor-cli-task-observer.git}"
INSTALL_REF="${MONITOR_INSTALL_REF:-main}"
ARCHIVE_URL="${MONITOR_ARCHIVE_URL:-https://codeload.github.com/ycloud-sean/monitor-cli-task-observer/tar.gz/refs/heads/$INSTALL_REF}"
INSTALL_ROOT="${MONITOR_INSTALL_ROOT:-$HOME/.monitor/monitor-cli-task-observer}"
BIN_DIR="${MONITOR_BIN_DIR:-$HOME/.local/bin}"
CURSOR_EXTENSIONS_DIR="${MONITOR_CURSOR_EXTENSIONS_DIR:-$HOME/.cursor/extensions}"
CURSOR_EXTENSION_ID="liangxin.monitor-cursor-bridge-0.1.0"
CURSOR_EXTENSION_DIR="$CURSOR_EXTENSIONS_DIR/$CURSOR_EXTENSION_ID"
PATH_EXPORT_LINE='export PATH="$HOME/.local/bin:$PATH"'

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

detect_shell_rc_file() {
  local shell_name
  shell_name="$(basename "${SHELL:-}")"

  case "$shell_name" in
    zsh)
      printf '%s\n' "$HOME/.zshrc"
      ;;
    bash)
      if [[ -f "$HOME/.bash_profile" || ! -f "$HOME/.bashrc" ]]; then
        printf '%s\n' "$HOME/.bash_profile"
      else
        printf '%s\n' "$HOME/.bashrc"
      fi
      ;;
    *)
      printf '%s\n' ""
      ;;
  esac
}

ensure_path_in_shell_rc() {
  local rc_file="$1"

  if [[ -z "$rc_file" ]]; then
    return 1
  fi

  mkdir -p "$(dirname "$rc_file")"
  touch "$rc_file"

  if ! grep -Fqx "$PATH_EXPORT_LINE" "$rc_file"; then
    printf '\n# Added by monitor installer\n%s\n' "$PATH_EXPORT_LINE" >>"$rc_file"
  fi

  return 0
}

update_existing_install() {
  local current_origin
  current_origin="$(git -C "$INSTALL_ROOT" remote get-url origin 2>/dev/null || true)"

  if git -C "$INSTALL_ROOT" fetch --depth=1 origin "$INSTALL_REF"; then
    git -C "$INSTALL_ROOT" checkout --force FETCH_HEAD
    return 0
  fi

  if [[ "$current_origin" != "$SSH_REPO_URL" ]]; then
    printf '默认远程更新失败，尝试切换到 SSH...\n'
    git -C "$INSTALL_ROOT" remote set-url origin "$SSH_REPO_URL"
    if git -C "$INSTALL_ROOT" fetch --depth=1 origin "$INSTALL_REF"; then
      git -C "$INSTALL_ROOT" checkout --force FETCH_HEAD
      return 0
    fi
  fi

  if [[ "$current_origin" != "$REPO_URL" ]]; then
    git -C "$INSTALL_ROOT" remote set-url origin "$REPO_URL"
  fi

  return 1
}

clone_install_repo() {
  if git clone --depth=1 --branch "$INSTALL_REF" "$REPO_URL" "$INSTALL_ROOT"; then
    return 0
  fi

  if [[ "$REPO_URL" != "$SSH_REPO_URL" ]]; then
    printf '默认克隆失败，尝试使用 SSH...\n'
    git clone --depth=1 --branch "$INSTALL_REF" "$SSH_REPO_URL" "$INSTALL_ROOT"
    return 0
  fi

  return 1
}

install_from_archive() {
  local temp_dir archive_path extracted_root extracted_dir
  temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/monitor-install.XXXXXX")"
  archive_path="$temp_dir/repo.tar.gz"
  extracted_root="$temp_dir/extracted"

  cleanup() {
    rm -rf "$temp_dir"
  }
  trap cleanup RETURN

  mkdir -p "$extracted_root"
  printf 'git 更新失败，回退到归档包安装...\n'
  curl -fsSL "$ARCHIVE_URL" -o "$archive_path"
  tar -xzf "$archive_path" -C "$extracted_root"

  extracted_dir="$(find "$extracted_root" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  if [[ -z "$extracted_dir" ]]; then
    printf '归档包解压失败，未找到源码目录。\n' >&2
    exit 1
  fi

  rm -rf "$INSTALL_ROOT"
  mkdir -p "$(dirname "$INSTALL_ROOT")"
  mv "$extracted_dir" "$INSTALL_ROOT"
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
  if ! update_existing_install; then
    install_from_archive
  fi
else
  if [[ -e "$INSTALL_ROOT" ]]; then
    printf '安装目录已存在但不是 git 仓库，改为归档包更新: %s\n' "$INSTALL_ROOT"
    install_from_archive
  else
    printf '克隆仓库到: %s\n' "$INSTALL_ROOT"
    if ! clone_install_repo; then
      install_from_archive
    fi
  fi
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

RC_FILE="$(detect_shell_rc_file)"
PATH_WRITTEN="false"
if ensure_path_in_shell_rc "$RC_FILE"; then
  PATH_WRITTEN="true"
fi

printf '\n安装完成。\n'
printf '命令入口:\n'
printf '  %s/monitor\n' "$BIN_DIR"
printf '  %s/monitord\n' "$BIN_DIR"
printf 'Cursor bridge 已安装到:\n'
printf '  %s\n' "$CURSOR_EXTENSION_DIR"

if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  if [[ "$PATH_WRITTEN" == "true" ]]; then
    printf '\n已自动写入 PATH 到: %s\n' "$RC_FILE"
    printf '当前终端不会被安装脚本直接改写；请执行下面任一命令刷新当前 shell:\n'
    if [[ -n "$RC_FILE" ]]; then
      printf '  source %s\n' "$RC_FILE"
    fi
    printf '  exec %s -l\n' "${SHELL:-/bin/zsh}"
  else
    printf '\n无法自动判断你的 shell 配置文件，请手动加入:\n'
    printf '  %s\n' "$PATH_EXPORT_LINE"
  fi
else
  printf '\n当前终端的 PATH 已包含 %s\n' "$BIN_DIR"
fi

printf '\n之后直接执行:\n'
printf '  monitor codex\n'
printf '\n如果 Cursor 正在运行，重启一次 Cursor，确保 bridge 扩展被加载。\n'
