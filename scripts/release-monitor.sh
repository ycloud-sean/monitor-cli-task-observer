#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
用法:
  bash scripts/release-monitor.sh [--version 1.2.3] [--skip-tests] [--dry-run] [--keep-temp-dirs]

说明:
  - 默认读取根 package.json 的 version 作为发布版本
  - 默认把当前 HEAD 推到当前分支和 main，并发布:
    1. 当前源码仓库
    2. homebrew-artifacts 分支
    3. ycloud-sean/homebrew-monitor tap 仓库
  - --dry-run 会跳过 commit / tag / push，但仍会执行构建和本地文件改写校验
EOF
}

log() {
  printf '[release-monitor] %s\n' "$*"
}

die() {
  printf '[release-monitor] %s\n' "$*" >&2
  exit 1
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    die "缺少必需命令: $1"
  fi
}

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "$ROOT_DIR" ]] || die "请在 monitor 仓库内执行。"
cd "$ROOT_DIR"

VERSION=""
SKIP_TESTS="false"
DRY_RUN="false"
KEEP_TEMP_DIRS="false"
REMOTE="${MONITOR_RELEASE_REMOTE:-origin}"
MAIN_BRANCH="${MONITOR_RELEASE_MAIN_BRANCH:-main}"
SOURCE_BRANCH="${MONITOR_RELEASE_SOURCE_BRANCH:-$(git branch --show-current 2>/dev/null || true)}"
ARTIFACTS_BRANCH="${MONITOR_RELEASE_ARTIFACTS_BRANCH:-homebrew-artifacts}"
TAP_REPO_URL="${MONITOR_RELEASE_TAP_REPO_URL:-git@github.com:ycloud-sean/homebrew-monitor.git}"
ARTIFACTS_WORKTREE_DIR="${MONITOR_RELEASE_ARTIFACTS_WORKTREE_DIR:-}"
TAP_REPO_DIR="${MONITOR_RELEASE_TAP_REPO_DIR:-}"
LOCAL_FORMULA_BACKUP=""
ARTIFACTS_DIR_AUTO="false"
TAP_DIR_AUTO="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --skip-tests)
      SKIP_TESTS="true"
      shift
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    --keep-temp-dirs)
      KEEP_TEMP_DIRS="true"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "不支持的参数: $1"
      ;;
  esac
done

require_command git
require_command node
require_command npm
require_command ruby
require_command shasum
require_command tar

if [[ -z "$SOURCE_BRANCH" ]]; then
  die "无法识别当前分支，请设置 MONITOR_RELEASE_SOURCE_BRANCH。"
fi

if [[ -z "$VERSION" ]]; then
  VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"
fi

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "版本号格式不合法: $VERSION"

TAG="v$VERSION"
BUNDLE_NAME="monitor-runtime-$TAG-macos-arm64.tar.gz"
BUNDLE_PATH="$ROOT_DIR/dist-runtime/$BUNDLE_NAME"
LOCAL_FORMULA_PATH="$ROOT_DIR/Formula/monitor.rb"

cleanup() {
  if [[ -n "$LOCAL_FORMULA_BACKUP" && -f "$LOCAL_FORMULA_BACKUP" ]]; then
    mv "$LOCAL_FORMULA_BACKUP" "$LOCAL_FORMULA_PATH"
  fi

  if [[ "$KEEP_TEMP_DIRS" != "true" ]]; then
    if [[ "$ARTIFACTS_DIR_AUTO" == "true" && -n "$ARTIFACTS_WORKTREE_DIR" && -d "$ARTIFACTS_WORKTREE_DIR" ]]; then
      git worktree remove --force "$ARTIFACTS_WORKTREE_DIR" >/dev/null 2>&1 || rm -rf "$ARTIFACTS_WORKTREE_DIR"
    fi
    if [[ "$TAP_DIR_AUTO" == "true" && -n "$TAP_REPO_DIR" && -d "$TAP_REPO_DIR" ]]; then
      rm -rf "$TAP_REPO_DIR"
    fi
  fi
}
trap cleanup EXIT

ensure_tracked_tree_clean() {
  local status
  status="$(git status --porcelain --untracked-files=no)"
  if [[ -n "$status" ]]; then
    printf '%s\n' "$status" >&2
    die "当前仓库存在未提交的 tracked 变更，请先提交或暂存。"
  fi
}

update_formula_file() {
  local file_path="$1"
  local version="$2"
  local sha="$3"

  MONITOR_RELEASE_VERSION="$version" MONITOR_RELEASE_SHA="$sha" ruby - "$file_path" <<'RUBY'
file_path = ARGV.fetch(0)
version = ENV.fetch("MONITOR_RELEASE_VERSION")
sha = ENV.fetch("MONITOR_RELEASE_SHA")
content = File.read(file_path)

updated = content
updated = updated.sub(/version "[^"]+"/, %(version "#{version}"))
updated = updated.sub(
  %r{url "https://cdn\.jsdelivr\.net/gh/ycloud-sean/monitor-cli-task-observer@homebrew-artifacts/monitor-runtime-v[^"]+-macos-arm64\.tar\.gz"},
  %(url "https://cdn.jsdelivr.net/gh/ycloud-sean/monitor-cli-task-observer@homebrew-artifacts/monitor-runtime-v#{version}-macos-arm64.tar.gz")
)
updated = updated.sub(
  %r{mirror "https://raw\.githubusercontent\.com/ycloud-sean/monitor-cli-task-observer/homebrew-artifacts/monitor-runtime-v[^"]+-macos-arm64\.tar\.gz"},
  %(mirror "https://raw.githubusercontent.com/ycloud-sean/monitor-cli-task-observer/homebrew-artifacts/monitor-runtime-v#{version}-macos-arm64.tar.gz")
)
updated = updated.sub(/sha256 "[^"]+"/, %(sha256 "#{sha}"))
File.write(file_path, updated)
RUBY
}

refresh_formula_file() {
  local file_path="$1"
  local version="$2"
  local sha="$3"
  local current_sha

  current_sha="$(shasum -a 256 "$file_path" | awk '{print $1}')"
  update_formula_file "$file_path" "$version" "$sha"

  if [[ "$current_sha" == "$(shasum -a 256 "$file_path" | awk '{print $1}')" ]]; then
    return 1
  fi

  return 0
}

commit_if_needed() {
  local repo_dir="$1"
  local commit_message="$2"
  shift 2
  local paths=("$@")
  local status

  status="$(git -C "$repo_dir" status --porcelain -- "${paths[@]}")"

  if [[ -z "$status" ]]; then
    log "无需提交: $commit_message"
    return 0
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    log "[dry-run] git -C $repo_dir add ${paths[*]}"
    log "[dry-run] git -C $repo_dir commit -m \"$commit_message\""
    return 0
  fi

  git -C "$repo_dir" add "${paths[@]}"
  git -C "$repo_dir" commit -m "$commit_message"
}

push_if_needed() {
  if [[ "$DRY_RUN" == "true" ]]; then
    log "[dry-run] $*"
    return 0
  fi

  "$@"
}

ensure_remote_ref() {
  local ref_name="$1"
  git fetch "$REMOTE" "$ref_name" --tags
}

if [[ -z "$ARTIFACTS_WORKTREE_DIR" ]]; then
  ARTIFACTS_WORKTREE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/monitor-release-artifacts.XXXXXX")"
  ARTIFACTS_DIR_AUTO="true"
fi

if [[ -z "$TAP_REPO_DIR" ]]; then
  TAP_REPO_DIR="$(mktemp -d "${TMPDIR:-/tmp}/monitor-release-tap.XXXXXX")"
  TAP_DIR_AUTO="true"
fi

ensure_tracked_tree_clean
ensure_remote_ref "$MAIN_BRANCH"
ensure_remote_ref "$ARTIFACTS_BRANCH"

log "发布版本: $VERSION"
log "源码分支: $SOURCE_BRANCH"
log "目标 main 分支: $MAIN_BRANCH"
log "artifacts 分支: $ARTIFACTS_BRANCH"
log "tap 仓库: $TAP_REPO_URL"

if [[ "$SKIP_TESTS" != "true" ]]; then
  log "运行测试"
  npm test -w monitor-cursor-bridge
  npm test -w @monitor/cli
fi

log "构建安装包和运行时 bundle"
npm run build:installable
bash ./scripts/build-runtime-bundle.sh "$TAG"
[[ -f "$BUNDLE_PATH" ]] || die "未找到运行时 bundle: $BUNDLE_PATH"
BUNDLE_SHA="$(shasum -a 256 "$BUNDLE_PATH" | awk '{print $1}')"
log "bundle sha256: $BUNDLE_SHA"

log "发布 homebrew-artifacts"
git worktree add --force --detach "$ARTIFACTS_WORKTREE_DIR" "$REMOTE/$ARTIFACTS_BRANCH"
cp "$BUNDLE_PATH" "$ARTIFACTS_WORKTREE_DIR/$BUNDLE_NAME"
commit_if_needed "$ARTIFACTS_WORKTREE_DIR" "release: monitor runtime $TAG" "$BUNDLE_NAME"
if [[ "$DRY_RUN" == "true" ]]; then
  log "[dry-run] git -C $ARTIFACTS_WORKTREE_DIR push $REMOTE HEAD:$ARTIFACTS_BRANCH"
else
  if ! git -C "$ARTIFACTS_WORKTREE_DIR" diff --quiet -- "$BUNDLE_NAME" || ! git -C "$ARTIFACTS_WORKTREE_DIR" diff --cached --quiet -- "$BUNDLE_NAME"; then
    die "artifacts 仓库还有未提交变更，无法继续推送。"
  fi
  git -C "$ARTIFACTS_WORKTREE_DIR" push "$REMOTE" "HEAD:$ARTIFACTS_BRANCH"
fi

log "更新当前仓库里的 Homebrew formula"
if [[ "$DRY_RUN" == "true" ]]; then
  LOCAL_FORMULA_BACKUP="$(mktemp "${TMPDIR:-/tmp}/monitor-formula-backup.XXXXXX")"
  cp "$LOCAL_FORMULA_PATH" "$LOCAL_FORMULA_BACKUP"
fi

if refresh_formula_file "$LOCAL_FORMULA_PATH" "$VERSION" "$BUNDLE_SHA"; then
  commit_if_needed "$ROOT_DIR" "chore: publish homebrew formula for $TAG" "Formula/monitor.rb"
else
  log "当前仓库 formula 已经是最新版本"
fi

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null 2>&1; then
  if [[ "$(git rev-list -n 1 "refs/tags/$TAG")" != "$(git rev-parse HEAD)" ]]; then
    die "标签 $TAG 已存在，但不指向当前 HEAD。"
  fi
  log "标签 $TAG 已存在且指向当前 HEAD"
else
  if [[ "$DRY_RUN" == "true" ]]; then
    log "[dry-run] git tag $TAG"
  else
    git tag "$TAG"
  fi
fi

if [[ "$SOURCE_BRANCH" == "$MAIN_BRANCH" ]]; then
  push_if_needed git push "$REMOTE" "HEAD:$MAIN_BRANCH" "refs/tags/$TAG"
else
  push_if_needed git push "$REMOTE" "HEAD:$SOURCE_BRANCH" "HEAD:$MAIN_BRANCH" "refs/tags/$TAG"
fi

log "发布 Homebrew tap 仓库"
rm -rf "$TAP_REPO_DIR"
git clone --depth=1 "$TAP_REPO_URL" "$TAP_REPO_DIR"

if refresh_formula_file "$TAP_REPO_DIR/Formula/monitor.rb" "$VERSION" "$BUNDLE_SHA"; then
  commit_if_needed "$TAP_REPO_DIR" "release: monitor $TAG" "Formula/monitor.rb"
else
  log "tap 仓库 formula 已经是最新版本"
fi

push_if_needed git -C "$TAP_REPO_DIR" push origin HEAD:main

log "发布完成: $TAG"
if [[ "$KEEP_TEMP_DIRS" == "true" ]]; then
  log "artifacts 工作树保留在: $ARTIFACTS_WORKTREE_DIR"
  log "tap 仓库副本保留在: $TAP_REPO_DIR"
fi
