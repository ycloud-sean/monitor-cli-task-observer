#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE_VERSION_INPUT="${1:-}"
if [[ -n "$BUNDLE_VERSION_INPUT" ]]; then
  BUNDLE_VERSION="$BUNDLE_VERSION_INPUT"
else
  PACKAGE_VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"
  BUNDLE_VERSION="v$PACKAGE_VERSION"
fi
if [[ -n "${MONITOR_RUNTIME_NODE_PATH:-}" ]]; then
  NODE_BIN_PATH="$MONITOR_RUNTIME_NODE_PATH"
else
  NODE_BIN_PATH="$(command -v node)"
fi
OUT_DIR="$ROOT_DIR/dist-runtime"
STAGE_DIR="$OUT_DIR/monitor-runtime-$BUNDLE_VERSION"

require_path() {
  if [[ ! -e "$1" ]]; then
    printf '缺少必需路径: %s\n' "$1" >&2
    exit 1
  fi
}

rm -rf "$STAGE_DIR"
mkdir -p \
  "$STAGE_DIR/apps/monitor-cli" \
  "$STAGE_DIR/apps/monitor-cursor-extension" \
  "$STAGE_DIR/packages/contracts" \
  "$STAGE_DIR/node_modules/@monitor" \
  "$STAGE_DIR/node_modules"

require_path "$ROOT_DIR/apps/monitor-cli/dist"
require_path "$ROOT_DIR/packages/contracts/dist"
require_path "$ROOT_DIR/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
require_path "$ROOT_DIR/node_modules/terminal-notifier/terminal-notifier.app"
require_path "$NODE_BIN_PATH"

NODE_MAJOR="$("$NODE_BIN_PATH" -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" != "22" ]]; then
  printf 'runtime bundle 当前要求 Node 22，实际为: %s\n' "$("$NODE_BIN_PATH" -v)" >&2
  exit 1
fi

cp -R "$ROOT_DIR/apps/monitor-cli/dist" "$STAGE_DIR/apps/monitor-cli/"
cp "$ROOT_DIR/apps/monitor-cli/package.json" "$STAGE_DIR/apps/monitor-cli/package.json"

cp -R "$ROOT_DIR/apps/monitor-cursor-extension/lib" "$STAGE_DIR/apps/monitor-cursor-extension/"
cp \
  "$ROOT_DIR/apps/monitor-cursor-extension/extension.js" \
  "$ROOT_DIR/apps/monitor-cursor-extension/package.json" \
  "$STAGE_DIR/apps/monitor-cursor-extension/"

cp -R "$ROOT_DIR/packages/contracts/dist" "$STAGE_DIR/packages/contracts/"
cp "$ROOT_DIR/packages/contracts/package.json" "$STAGE_DIR/packages/contracts/package.json"

mkdir -p "$STAGE_DIR/node_modules/@monitor/contracts"
cp -R "$ROOT_DIR/packages/contracts/dist" "$STAGE_DIR/node_modules/@monitor/contracts/"
cp "$ROOT_DIR/packages/contracts/package.json" "$STAGE_DIR/node_modules/@monitor/contracts/package.json"

mkdir -p "$STAGE_DIR/node_modules/better-sqlite3/build/Release"
cp -R "$ROOT_DIR/node_modules/better-sqlite3/lib" "$STAGE_DIR/node_modules/better-sqlite3/"
cp "$ROOT_DIR/node_modules/better-sqlite3/package.json" "$STAGE_DIR/node_modules/better-sqlite3/package.json"
cp \
  "$ROOT_DIR/node_modules/better-sqlite3/build/Release/better_sqlite3.node" \
  "$STAGE_DIR/node_modules/better-sqlite3/build/Release/"

mkdir -p \
  "$STAGE_DIR/node_modules/bindings" \
  "$STAGE_DIR/node_modules/file-uri-to-path" \
  "$STAGE_DIR/node_modules/terminal-notifier"

cp \
  "$ROOT_DIR/node_modules/bindings/package.json" \
  "$ROOT_DIR/node_modules/bindings/bindings.js" \
  "$STAGE_DIR/node_modules/bindings/"

cp \
  "$ROOT_DIR/node_modules/file-uri-to-path/package.json" \
  "$ROOT_DIR/node_modules/file-uri-to-path/index.js" \
  "$STAGE_DIR/node_modules/file-uri-to-path/"

cp \
  "$ROOT_DIR/node_modules/terminal-notifier/package.json" \
  "$ROOT_DIR/node_modules/terminal-notifier/terminal-notifier.js" \
  "$STAGE_DIR/node_modules/terminal-notifier/"
cp -R \
  "$ROOT_DIR/node_modules/terminal-notifier/terminal-notifier.app" \
  "$STAGE_DIR/node_modules/terminal-notifier/"

mkdir -p "$STAGE_DIR/runtime/bin"
cp "$NODE_BIN_PATH" "$STAGE_DIR/runtime/bin/node"
chmod +x "$STAGE_DIR/runtime/bin/node"

mkdir -p "$OUT_DIR"
ARCHIVE_PATH="$OUT_DIR/monitor-runtime-$BUNDLE_VERSION-macos-arm64.tar.gz"
rm -f "$ARCHIVE_PATH"
tar -czf "$ARCHIVE_PATH" -C "$OUT_DIR" "monitor-runtime-$BUNDLE_VERSION"

printf '运行时打包完成:\n'
printf '  %s\n' "$ARCHIVE_PATH"
printf '内置 Node:\n'
printf '  %s\n' "$NODE_BIN_PATH"
shasum -a 256 "$ARCHIVE_PATH"
