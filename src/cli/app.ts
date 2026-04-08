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
import { manageOtherInteractive } from "./other.js";
import { listTheme } from "../config/inquirer.config.js";
import chalk from "chalk";
import { buse } from "../local/index.js";

const LOGO = String.raw`
  ▄▄▄▄     ▄▄     ▄▄▄   ▄▄▄▄     ▄▄▄▄   ▄▄▄  ▄▄ ▄▄  ▄▄ ▄▄ 
 ██▀▀▀ ▄▄▄ ██    ██▀██ ██ ▄▄ ▄▄▄ ██▀██ ██▀██ ██ ██  ▀███▀ 
 ▀████     ██▄▄▄ ▀███▀ ▀███▀     ████▀ ██▀██ ██ ██▄▄▄ █
`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getAppMeta(): { name: string; version: string } {
  try {
    const p = path.resolve(__dirname, "../../package.json");
    const raw = fs.readFileSync(p, "utf8");
    const parsed: any = JSON.parse(raw);
    const name = String(parsed?.name ?? "commit-log-daily").trim() || "commit-log-daily";
    const version = String(parsed?.version ?? "").trim();
    return { name, version };
  } catch {
    return { name: "commit-log-daily", version: "" };
  }
}

function colorizeRainbow(text: unknown): string {
  if (!process.stdout.isTTY) return String(text ?? "");
  const lines = String(text ?? "").split(/\r?\n/);
  const palette = [203, 143, 221, 67, 104, 179];
  const reset = "\u001b[0m";
  return lines
    .map((line, i) => {
      if (!line.trim()) return line;
      const color = palette[i % palette.length];
      return `\u001b[38;5;${color}m${line}${reset}`;
    })
    .join("\n");
}

async function getInquirer(): Promise<any> {
  const mod: any = await import("inquirer");
  const inquirer = mod.default ?? mod;
  const originalPrompt = inquirer.prompt.bind(inquirer);
  return {
    ...inquirer,
    prompt: (questions: any, ...rest: any[]) => {
      const applyTheme = (q: any) => {
        if (!q || typeof q !== "object" || Array.isArray(q)) return q;
        if (q instanceof inquirer.Separator) return q;
        const type = String(q.type ?? "");
        if ((type !== "list" && type !== "checkbox") || q.theme != null) return q;
        return { ...q, theme: listTheme };
      };
      const nextQuestions = Array.isArray(questions) ? questions.map(applyTheme) : applyTheme(questions);
      return originalPrompt(nextQuestions, ...rest);
    },
  };
}

export async function run(argv: string[]): Promise<number> {
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
  const header = chalk.inverse("▮▬") + (meta.version ? ` ${meta.name} v${meta.version}` : meta.name);
  const mainMenuChoices = [
    { name: chalk.bold("Generate Report"), value: "report", description: buse("menu_generate_report").zh },
    { name: "projects Config ", value: "projects", description: buse("menu_projects_config").zh },
    { name: "Git Config", value: "git", description: buse("menu_git_config").zh },
    { name: "AI Config", value: "ai", description: buse("menu_ai_config").zh },
    { name: "Other Config", value: "other", description: "其他配置" },
    { name: "Help", value: "help", description: buse("menu_help").zh },
    { name: chalk.red("Exit"), value: "exit", description: buse("menu_exit").zh },
  ];
  for (;;) {
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: header,
        choices: mainMenuChoices,
        loop: true,
        pageSize: mainMenuChoices.length,
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
    if (action === "other") {
      await manageOtherInteractive(inquirer);
      continue;
    }
    if (action === "report") {
      await generateReportInteractive(inquirer);
      continue;
    }
  }
}

export async function runAndExit(argv: string[]): Promise<void> {
  const code = await run(argv);
  process.exit(code);
}
