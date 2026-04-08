import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { loadConfig, removeProjectByName, upsertProject, validateRepoPath, getConfigFilePath, type Project } from "../config.js";
import type { ParsedArgs } from "../utils/cli.js";

function buildProjectChoices(projects: Project[]): Array<{ name: string; value: string }> {
  const list = Array.isArray(projects) ? projects : [];
  return list.map((p) => ({ name: `${p.name} (${p.path})`, value: p.name }));
}

function isGitRepoDir(dirPath: string): boolean {
  try {
    const gitDir = path.join(dirPath, ".git");
    return fs.existsSync(gitDir);
  } catch {
    return false;
  }
}

function scanGitRepos(input: { rootDir: string; depth?: number }): string[] {
  const root = String(input.rootDir ?? "").trim();
  const maxDepth = Number.isFinite(Number(input.depth)) ? Math.max(0, Math.floor(Number(input.depth))) : 1;
  if (!root) return [];
  if (!fs.existsSync(root)) return [];

  const results: string[] = [];
  const ignoreNames = new Set(["node_modules", ".git", ".pnpm-store", "dist", "build", "out"]);

  const walk = (dir: string, remainingDepth: number) => {
    if (!dir) return;
    if (isGitRepoDir(dir)) {
      results.push(dir);
      return;
    }
    if (remainingDepth <= 0) return;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (ignoreNames.has(ent.name)) continue;
      walk(path.join(dir, ent.name), remainingDepth - 1);
    }
  };

  walk(path.resolve(root), maxDepth);
  return Array.from(new Set(results)).sort((a, b) => a.localeCompare(b));
}

function toUniqueProjectName(existingNames: Set<string>, baseName: string): string {
  const trimmed = String(baseName ?? "").trim() || "project";
  if (!existingNames.has(trimmed)) return trimmed;
  for (let i = 2; i < 999; i += 1) {
    const candidate = `${trimmed}-${i}`;
    if (!existingNames.has(candidate)) return candidate;
  }
  return `${trimmed}-${Date.now()}`;
}

async function selectProjectInteractive(inquirer: any, projects: Project[], message: string): Promise<{ name: string }> {
  if (!projects.length) return { name: "" };
  const { name } = await inquirer.prompt([
    { type: "list", name: "name", loop: false, message, choices: [...buildProjectChoices(projects), { name: "返回", value: "" }] },
  ]);
  return { name: String(name ?? "") };
}

async function scanAndImportInteractive(inquirer: any): Promise<void> {
  const config = loadConfig();
  const projects = Array.isArray(config.projects) ? config.projects : [];
  const existingPaths = new Set(projects.map((p) => path.resolve(String(p.path ?? ""))));
  const existingNames = new Set(projects.map((p) => String(p.name ?? "")));

  const defaults = {
    rootDir: String(config?.projectsScan?.rootDir ?? "").trim() || process.cwd(),
    depth: String(
      Number.isFinite(Number(config?.projectsScan?.depth)) ? Math.max(0, Math.floor(Number(config.projectsScan.depth))) : 1,
    ),
  };
  const answers = await inquirer.prompt([
    { type: "input", name: "rootDir", message: "扫描目录（root）", default: defaults.rootDir, validate: (v: unknown) => (String(v).trim() ? true : "必填") },
    {
      type: "input",
      name: "depth",
      message: "扫描深度（默认 1=只扫一层子目录）",
      default: defaults.depth,
      validate: (v: unknown) => (Number(String(v).trim()) >= 0 ? true : "必须是 >= 0 的数字"),
    },
  ]);

  const rootDir = path.resolve(String(answers.rootDir).trim());
  const depth = Math.floor(Number(String(answers.depth).trim()));

  const found = scanGitRepos({ rootDir, depth });
  const candidates = found
    .map((p) => path.resolve(p))
    .filter((p) => !existingPaths.has(p))
    .filter((p) => validateRepoPath(p).ok);

  if (!candidates.length) {
    console.log("未发现可导入的新 git 仓库。");
    return;
  }

  const { picked } = await inquirer.prompt([
    {
      type: "checkbox",
      name: "picked",
      loop: false,
      message: `发现 ${candidates.length} 个 git 仓库，选择要导入的项目`,
      choices: candidates.map((p) => ({ name: `${path.basename(p)} (${p})`, value: p })),
      validate: (v: unknown) => (Array.isArray(v) && v.length ? true : "至少选择一个"),
    },
  ]);

  let added = 0;
  for (const repoPath of picked as unknown[]) {
    const repo = String(repoPath ?? "").trim();
    if (!repo) continue;
    const baseName = path.basename(repo);
    const name = toUniqueProjectName(existingNames, baseName);
    existingNames.add(name);
    existingPaths.add(repo);
    upsertProject({ name, repoPath: repo });
    added += 1;
  }

  console.log(`已导入 ${added} 个项目。`);
}

async function manageProjectListInteractive(inquirer: any): Promise<void> {
  for (;;) {
    const config = loadConfig();
    const projects = Array.isArray(config.projects) ? config.projects : [];
    if (!projects.length) {
      console.log("（空）");
      return;
    }

    const picked = await selectProjectInteractive(inquirer, projects, "选择一个项目");
    if (!picked.name) return;

    const current = projects.find((p) => p.name === picked.name);
    if (!current) {
      console.log("未找到该项目。");
      continue;
    }

    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: `项目：${current.name}`,
        choices: [
          { name: "编辑", value: "edit" },
          { name: "删除", value: "remove" },
          { name: "返回列表", value: "back" },
        ],
      },
    ]);

    if (action === "back") continue;

    if (action === "remove") {
      const { confirm } = await inquirer.prompt([
        { type: "confirm", name: "confirm", message: `确认删除 ${current.name}？`, default: false },
      ]);
      if (!confirm) continue;
      const removed = removeProjectByName(current.name);
      console.log(removed ? "已删除。" : "未找到该项目。");
      continue;
    }

    if (action === "edit") {
      const answers = await inquirer.prompt([
        { type: "input", name: "name", message: "项目名", default: current.name, validate: (v: unknown) => (String(v).trim() ? true : "必填") },
        { type: "input", name: "repoPath", message: "本地仓库路径", default: current.path, validate: (v: unknown) => (String(v).trim() ? true : "必填") },
      ]);

      const nextName = String(answers.name).trim();
      const nextPath = String(answers.repoPath).trim();
      const repoCheck = validateRepoPath(nextPath);
      if (!repoCheck.ok) console.log(`提示：路径校验失败：${repoCheck.reason}（仍会写入配置，但后续扫描可能失败）`);

      if (nextName !== current.name) removeProjectByName(current.name);
      upsertProject({ name: nextName, repoPath: nextPath });
      console.log("已保存。");
      continue;
    }
  }
}

export async function manageProjectsInteractive(inquirer: any): Promise<void> {
  for (;;) {
    const config = loadConfig();
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "项目配置",
        choices: [
          { name: `项目列表（选择编辑/删除）（${config.projects.length}）`, value: "list" },
          { name: "手动添加指定项目", value: "add" },
          { name: "扫描目录并导入项目", value: "scan" },
          { name: "返回", value: "back" },
        ],
      },
    ]);

    if (action === "back") return;

    if (action === "list") {
      await manageProjectListInteractive(inquirer);
      continue;
    }

    if (action === "add") {
      const answers = await inquirer.prompt([
        { type: "input", name: "name", message: "项目名", validate: (v: unknown) => (String(v).trim() ? true : "必填") },
        { type: "input", name: "repoPath", message: "本地仓库路径", validate: (v: unknown) => (String(v).trim() ? true : "必填") },
      ]);
      const repoCheck = validateRepoPath(answers.repoPath);
      if (!repoCheck.ok) console.log(`提示：路径校验失败：${repoCheck.reason}（仍会写入配置，但后续扫描可能失败）`);
      upsertProject({ name: answers.name, repoPath: answers.repoPath });
      console.log("已保存。");
      continue;
    }

    if (action === "scan") {
      await scanAndImportInteractive(inquirer);
      continue;
    }
  }
}

export function handleProjectsCommand(input: Pick<ParsedArgs, "subcmd" | "flags">): number {
  const subcmd = input.subcmd;
  const flags = input.flags;

  if (subcmd === "list") {
    const config = loadConfig();
    if (!config.projects.length) {
      console.log("（空）");
      console.log(`配置文件：${getConfigFilePath()}`);
      return 0;
    }
    for (const p of config.projects) console.log(`- ${p.name}: ${p.path}`);
    console.log(`配置文件：${getConfigFilePath()}`);
    return 0;
  }

  if (subcmd === "add") {
    const name = flags.name;
    const repoPath = flags.path;
    if (!name || !repoPath || typeof name !== "string" || typeof repoPath !== "string") {
      console.error("缺少参数：--name / --path");
      return 1;
    }
    const repoCheck = validateRepoPath(repoPath);
    if (!repoCheck.ok) console.log(`提示：路径校验失败：${repoCheck.reason}（仍会写入配置，但后续扫描可能失败）`);
    upsertProject({ name, repoPath });
    console.log("已保存。");
    return 0;
  }

  if (subcmd === "remove") {
    const name = flags.name;
    if (!name || typeof name !== "string") {
      console.error("缺少参数：--name");
      return 1;
    }
    const removed = removeProjectByName(name);
    console.log(removed ? "已删除。" : "未找到该项目。");
    return 0;
  }

  console.error("未知子命令：projects list|add|remove");
  return 1;
}
