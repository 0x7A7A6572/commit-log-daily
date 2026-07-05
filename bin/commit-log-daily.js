#!/usr/bin/env node
// commit-log-daily CLI — 见 bin/agent.js 启动 Agent TUI 模式
import process from "node:process";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log("commit-log-daily v2.0.0");
  console.log("");
  console.log("用法:");
  console.log("  commit-log-daily      启动 Agent TUI 交互模式");
  console.log("  cld-agent             启动 Agent TUI 交互模式");
  console.log("");
  console.log("交互模式中：");
  console.log("  Ctrl+C    退出");
  process.exit(0);
}

// 默认启动 Agent TUI
const { startAgentTui } = await import("../dist/index.js");
startAgentTui();
