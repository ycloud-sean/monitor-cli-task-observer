class Monitor < Formula
  desc "Task observer wrapper for codex and claude on macOS"
  homepage "https://github.com/ycloud-sean/monitor-cli-task-observer"
  license "ISC"

  head "https://github.com/ycloud-sean/monitor-cli-task-observer.git", branch: "main"

  depends_on "node"

  def install
    odie "monitor currently only supports macOS" unless OS.mac?

    libexec.install Dir["*"], Dir[".*"] - [".", ".."]

    cd libexec do
      system "npm", "install",
             "--workspace", "packages/contracts",
             "--workspace", "apps/monitor-cli",
             "--workspace", "apps/monitor-cursor-extension"
      system "npm", "run", "-w", "@monitor/contracts", "build"
      system "npm", "run", "-w", "@monitor/cli", "build"
      system "npm", "run", "-w", "monitor-cursor-bridge", "build"
    end

    (bin/"monitor").write <<~EOS
      #!/bin/bash
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/apps/monitor-cli/dist/bin/monitor.js" "$@"
    EOS
    (bin/"monitord").write <<~EOS
      #!/bin/bash
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/apps/monitor-cli/dist/bin/monitord.js" "$@"
    EOS
    chmod 0755, bin/"monitor"
    chmod 0755, bin/"monitord"
  end

  def caveats
    <<~EOS
      Homebrew 已安装 `monitor` 和 `monitord`。

      如果你在 Cursor 中第一次执行 `monitor codex` 或 `monitor claude`，
      monitor 会自动补装 Cursor bridge；若当时 Cursor 已在运行，请重启一次 Cursor。

      之后直接执行：
        monitor codex
    EOS
  end

  test do
    assert_match "用法:", shell_output("#{bin}/monitor --help")
  end
end
