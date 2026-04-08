import path from "node:path";
import process from "node:process";

import { loadConfig, updateProjectsScanConfig, updateReportConfig } from "../config.js";
import { formatKeyValueTable } from "../utils/cli.js";

function formatOutputMode(mode: unknown): string {
  const m = String(mode ?? "").trim();
  if (m === "file") return "仅导出文件";
  if (m === "both") return "终端 + 文件";
  return "仅终端显示";
}

export async function manageOtherInteractive(inquirer: any): Promise<void> {
  for (;;) {
    const config = loadConfig();
    const outputDir = String(config?.report?.outputDir ?? "").trim();
    const outputMode = String(config?.report?.outputMode ?? "stdout").trim();
    const scanRootDir = String(config?.projectsScan?.rootDir ?? "").trim();
    const scanDepth = Number.isFinite(Number(config?.projectsScan?.depth))
      ? Math.max(0, Math.floor(Number(config.projectsScan.depth)))
      : 1;

    const table = formatKeyValueTable([
      { k: "报告默认导出目录", v: outputDir || "（当前目录）" },
      { k: "报告默认输出方式", v: `${formatOutputMode(outputMode)} (${outputMode || "stdout"})` },
      { k: "扫描默认 root", v: scanRootDir || "（当前目录）" },
      { k: "扫描默认 depth", v: String(scanDepth) },
    ]);

    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: `其他配置\n\n${table}`,
        choices: [
          { name: "设置报告默认导出目录", value: "reportDir" },
          { name: "设置报告默认输出方式", value: "reportMode" },
          { name: "设置扫描默认 root / depth", value: "scanDefaults" },
          { name: "返回", value: "back" },
        ],
      },
    ]);

    if (action === "back") return;

    if (action === "reportDir") {
      const { dir } = await inquirer.prompt([{ type: "input", name: "dir", message: "报告默认导出目录（留空=当前目录）", default: outputDir }]);
      updateReportConfig({ outputDir: String(dir ?? "").trim() });
      console.log("已保存。");
      continue;
    }

    if (action === "reportMode") {
      const choices = [
        { name: "仅终端显示", value: "stdout" },
        { name: "仅导出文件", value: "file" },
        { name: "终端 + 文件", value: "both" },
      ];
      const idx = Math.max(0, choices.findIndex((c) => c.value === outputMode));
      const { mode } = await inquirer.prompt([{ type: "list", name: "mode", message: "报告默认输出方式", choices, default: idx }]);
      updateReportConfig({ outputMode: String(mode).trim() });
      console.log("已保存。");
      continue;
    }

    if (action === "scanDefaults") {
      const defaults = { rootDir: scanRootDir || process.cwd(), depth: String(scanDepth) };
      const answers = await inquirer.prompt([
        { type: "input", name: "rootDir", message: "扫描路径 root（留空=当前目录）", default: defaults.rootDir },
        {
          type: "input",
          name: "depth",
          message: "扫描深度 depth（>=0）",
          default: defaults.depth,
          validate: (v: unknown) => (Number(String(v).trim()) >= 0 ? true : "必须是 >= 0 的数字"),
        },
      ]);
      const rootInput = String(answers.rootDir ?? "").trim();
      const resolved = rootInput ? path.resolve(rootInput) : "";
      const depth = Math.max(0, Math.floor(Number(String(answers.depth ?? "").trim())));
      updateProjectsScanConfig({ rootDir: resolved, depth });
      console.log("已保存。");
      continue;
    }
  }
}
