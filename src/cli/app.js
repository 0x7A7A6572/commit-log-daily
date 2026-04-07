import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getConfigFilePath } from "../config.js";
import { parseArgs } from "../utils/cli.js";
import { printAppInfo, printHelp } from "./help.js";
import { manageProjectsInteractive, handleProjectsCommand } from "./projects.js";
import { manageGitInteractive } from "./git.js";
import { manageAiInteractive } from "./ai.js";
import { generateReportInteractive } from "./report.js";

const LOGO = String.raw`
  ▄▄▄▄     ▄▄     ▄▄▄   ▄▄▄▄     ▄▄▄▄   ▄▄▄  ▄▄ ▄▄  ▄▄ ▄▄ 
 ██▀▀▀ ▄▄▄ ██    ██▀██ ██ ▄▄ ▄▄▄ ██▀██ ██▀██ ██ ██  ▀███▀ 
 ▀████     ██▄▄▄ ▀███▀ ▀███▀     ████▀ ██▀██ ██ ██▄▄▄ █
`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getAppMeta() {
  try {
    const p = path.resolve(__dirname, "../../package.json");
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw);
    const name = String(parsed?.name ?? "commit-log-daily").trim() || "commit-log-daily";
    const version = String(parsed?.version ?? "").trim();
    return { name, version };
  } catch {
    return { name: "commit-log-daily", version: "" };
  }
}

function colorizeRainbow(text) {
  if (!process.stdout.isTTY) return text;
  const lines = String(text ?? "").split(/\r?\n/);
  const palette = [196, 202, 226, 46, 51, 21, 201];
  const reset = "\u001b[0m";
  return lines
    .map((line, i) => {
      if (!line.trim()) return line;
      const color = palette[i % palette.length];
      return `\u001b[38;5;${color}m${line}${reset}`;
    })
    .join("\n");
}

async function getInquirer() {
  const mod = await import("inquirer");
  return mod.default ?? mod;
}

export async function run(argv) {
  const parsed = parseArgs(argv);
  const configFilePath = getConfigFilePath();
  if (parsed.raw.includes("--help") || parsed.raw.includes("-h")) {
    printHelp(argv, configFilePath);
    return 0;
  }

  if (parsed.cmd === "projects") {
    return handleProjectsCommand(parsed);
  }

  if (parsed.cmd === "report") {
    const inquirer = await getInquirer();
    await generateReportInteractive(inquirer);
    return 0;
  }

  if (parsed.cmd) {
    console.error(`未知命令：${parsed.cmd}`);
    printHelp(argv, configFilePath);
    return 1;
  }

  const inquirer = await getInquirer();
  console.log(colorizeRainbow(LOGO));
  const meta = getAppMeta();
  const header = meta.version ? `${meta.name} v${meta.version}` : meta.name;
  for (;;) {
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: header,
        choices: [
          { name: "生成报告", value: "report" },
          new inquirer.Separator("——————————————"),
          { name: "配置项目", value: "projects" },
          { name: "配置 Git", value: "git" },
          { name: "配置 AI", value: "ai" },
          new inquirer.Separator("——————————————"),
          { name: "帮助", value: "help" },
          { name: "退出", value: "exit" },
        ],
      },
    ]);

    if (action === "exit") return 0;
    if (action === "help") {
      printAppInfo({ argv, configFilePath });
      continue;
    }
    if (action === "projects") {
      await manageProjectsInteractive(inquirer);
      continue;
    }
    if (action === "git") {
      await manageGitInteractive(inquirer);
      continue;
    }
    if (action === "ai") {
      await manageAiInteractive(inquirer);
      continue;
    }
    if (action === "report") {
      await generateReportInteractive(inquirer);
      continue;
    }
  }
}

export async function runAndExit(argv) {
  const code = await run(argv);
  process.exit(code);
}
