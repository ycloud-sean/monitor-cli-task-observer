class Monitor < Formula
  desc "Task observer wrapper for codex and claude on macOS"
  homepage "https://github.com/ycloud-sean/monitor-cli-task-observer"
  license "ISC"
  version "1.0.13"

  url "https://cdn.jsdelivr.net/gh/ycloud-sean/monitor-cli-task-observer@homebrew-artifacts/monitor-runtime-v1.0.13-macos-arm64.tar.gz"
  mirror "https://raw.githubusercontent.com/ycloud-sean/monitor-cli-task-observer/homebrew-artifacts/monitor-runtime-v1.0.13-macos-arm64.tar.gz"
  sha256 "4361f9fde982e08c4183df998329311ce67157b5c45443a832c79f17b4dceffc"
  head "https://github.com/ycloud-sean/monitor-cli-task-observer.git", branch: "main"

  depends_on arch: :arm64
  depends_on :macos

  def install
    mkdir_p libexec
    libexec.install Dir["*"]

    runner = libexec/"run-with-node22"
    runner.write <<~EOS
      #!/bin/bash
      set -euo pipefail

      if ! command -v node >/dev/null 2>&1; then
        printf 'monitor 需要预先安装 Node.js 22.x，并确保 node 在 PATH 中。\n' >&2
        exit 1
      fi

      node_version="$(node -v 2>/dev/null || true)"
      node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
      if [[ "$node_major" != "22" ]]; then
        printf 'monitor 当前要求 Node.js 22.x，实际为: %s\n' "${node_version:-unknown}" >&2
        exit 1
      fi

      exec node "$@"
    EOS

    (bin/"monitor").write <<~EOS
      #!/bin/bash
      exec "#{runner}" "#{libexec}/apps/monitor-cli/dist/bin/monitor.js" "$@"
    EOS
    (bin/"monitord").write <<~EOS
      #!/bin/bash
      exec "#{runner}" "#{libexec}/apps/monitor-cli/dist/bin/monitord.js" "$@"
    EOS
    chmod 0755, runner
    chmod 0755, bin/"monitor"
    chmod 0755, bin/"monitord"
  end

  def caveats
    <<~EOS
      Homebrew 已安装 `monitor` 和 `monitord`。

      运行前请确保你的 PATH 中已有 `node`，并且版本为 Node.js 22.x。

      如果你在 Cursor 中第一次执行 `monitor codex` 或 `monitor claude`，
      monitor 会自动补装 Cursor bridge；若当时 Cursor 已在运行，请重启一次 Cursor。

      之后直接执行：
        monitor codex
    EOS
  end

  test do
    if which("node")
      output = shell_output("#{bin}/monitor --help")
      assert_match "用法:", output
    else
      output = shell_output("#{bin}/monitor --help", 1)
      assert_match "Node.js 22.x", output
    end
  end
end
