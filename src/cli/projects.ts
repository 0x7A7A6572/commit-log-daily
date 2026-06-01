import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { loadConfig, removeProjectByName, setGitAuthorFilter, upsertProject, validateRepoPath, getConfigFilePath, type Project } from "../config.js";
import { readGitLog, getRangeByPreset, parseDateInput, branchesContainingCommit, detectAuthorPattern, listGitRemotes, type DateRange, type RangePreset } from "../git.js";
import { buildSummaryMessages } from "../ai/prompt.js";
import type { ParsedArgs } from "../utils/cli.js";
import { formatDateYmd, makeBackChoice, makeCliChoice } from "../utils/cli.js";
import { groupCommitsByRule, ruleNeedsBranches } from "../utils/grouping.js";
import chalk from "chalk";
import stringWidth from "string-width";

function buildProjectChoices(projects: Project[]): Array<{ name: string; value: string }> {
  const list = Array.isArray(projects) ? projects : [];
  return list.map((p) => makeCliChoice({ title: p.name, stats: p.path, value: p.name }));
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
    { type: "list", name: "name", loop: false, message, choices: [...buildProjectChoices(projects), makeBackChoice({ value: "" })] },
  ]);
  return { name: String(name ?? "") };
}

async function pause(inquirer: any, message: string = "按回车继续"): Promise<void> {
  await inquirer.prompt([{ type: "input", name: "__pause__", message }]);
}

async function chooseRangeInteractive(inquirer: any): Promise<{ preset: RangePreset | "custom"; range: DateRange }> {
  const { preset } = await inquirer.prompt([
    {
      type: "list",
      name: "preset",
      message: "选择时间范围",
      choices: [
        makeCliChoice({ title: "日报", description: "今天 00:00 至今", value: "daily" }),
        makeCliChoice({ title: "周报", description: "本周一 00:00 至今", value: "weekly" }),
        makeCliChoice({ title: "月报", description: "本月 1 号 00:00 至今", value: "monthly" }),
        makeCliChoice({ title: "年报", description: "今年 1 月 1 号 00:00 至今", value: "yearly" }),
        makeCliChoice({ title: "自定义", description: "输入起止日期", value: "custom" }),
      ],
    },
  ]);

  if (preset !== "custom") {
    const range = getRangeByPreset(preset as RangePreset);
    return { preset: preset as RangePreset, range };
  }

  const answers = await inquirer.prompt([
    { type: "input", name: "start", message: "开始日期（YYYY-MM-DD）", validate: (v: unknown) => (parseDateInput(v) ? true : "格式不对") },
    { type: "input", name: "end", message: "结束日期（YYYY-MM-DD，可留空=今天）", validate: (v: unknown) => (!String(v).trim() || parseDateInput(v) ? true : "格式不对") },
  ]);

  const start = parseDateInput(answers.start);
  const endInput = parseDateInput(answers.end);
  if (!start) throw new Error("开始日期无效");
  const end = endInput ?? new Date();
  end.setHours(23, 59, 59, 999);
  start.setHours(0, 0, 0, 0);
  if (start.getTime() > end.getTime()) throw new Error("开始日期不能晚于结束日期");
  return { preset: "custom", range: { start, end } };
}

function uniqueSorted(items: string[]): string[] {
  return Array.from(new Set(items.map((s) => String(s ?? "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function sliceSection(input: { text: string; start: string; end?: string }): string {
  const text = String(input.text ?? "");
  const start = String(input.start ?? "");
  const end = String(input.end ?? "");
  if (!start) return "";
  const i = text.indexOf(start);
  if (i < 0) return "";
  if (!end) return text.slice(i).trim();
  const j = text.indexOf(end, i + start.length);
  if (j < 0) return text.slice(i).trim();
  return text.slice(i, j).trim();
}

function formatTable(input: { headers: string[]; rows: string[][] }): string {
  const headers = (Array.isArray(input.headers) ? input.headers : []).map((h) => String(h ?? ""));
  const rows = (Array.isArray(input.rows) ? input.rows : []).map((r) => (Array.isArray(r) ? r : []).map((c) => String(c ?? "")));
  const colCount = Math.max(headers.length, ...rows.map((r) => r.length));
  const cols = Array.from({ length: colCount }, (_, i) => i);
  const widths = cols.map((i) => Math.max(stringWidth(headers[i] ?? ""), ...rows.map((r) => stringWidth(r[i] ?? ""))));
  const cell = (text: string, w: number) => {
    const s = String(text ?? "");
    const pad = Math.max(0, w - stringWidth(s));
    return ` ${s}${" ".repeat(pad)} `;
  };
  const line = `+${widths.map((w) => "-".repeat(w + 2)).join("+")}+`;
  const out: string[] = [];
  out.push(line);
  out.push(`|${cols.map((i) => cell(headers[i] ?? "", widths[i])).join("|")}|`);
  out.push(line);
  for (const r of rows) out.push(`|${cols.map((i) => cell(r[i] ?? "", widths[i])).join("|")}|`);
  out.push(line);
  return out.join("\n");
}

function inferCommitTypeFromSubject(subject: string): string {
  const s = String(subject ?? "").trim();
  if (!s) return "unknown";
  const m = s.match(/^([a-zA-Z][a-zA-Z0-9_-]*)(?:\([^)]+\))?(!)?:/);
  if (m) return String(m[1] ?? "").toLowerCase();
  const m2 = s.match(/^([a-zA-Z][a-zA-Z0-9_-]*)\s*:/);
  if (m2) return String(m2[1] ?? "").toLowerCase();
  return "other";
}

async function previewProjectDataInteractive(inquirer: any, project: Project): Promise<void> {
  const cfg = loadConfig();
  let authorPattern = String(cfg?.git?.author ?? "").trim();
  if (!authorPattern) {
    const detected = String(detectAuthorPattern(project.path) ?? "").trim();
    if (detected) {
      setGitAuthorFilter(detected);
      authorPattern = detected;
    }
  }
  const noiseEnabled = Boolean(cfg?.git?.filterNoise);
  const groupingCfg = cfg?.features?.grouping ?? { enabled: true, defaultRuleId: "", rules: [] };
  const groupingEnabled = (groupingCfg as any)?.enabled !== false;
  const enabledRules = (Array.isArray(groupingCfg.rules) ? groupingCfg.rules : []).filter((r) => r && r.enabled);
  const hasGroupingRules = Boolean(enabledRules.length);
  const { preset, range } = await chooseRangeInteractive(inquirer);
  if (!authorPattern) {
    console.log("未设置提交人过滤。请先在 Git Config 中设置提交人过滤。");
    await pause(inquirer);
    return;
  }
  const commitsRaw = readGitLog({ repoPath: project.path, start: range.start, end: range.end, authorPattern });
  const isNoise = (subject: unknown) => {
    const s = String(subject ?? "").trim();
    if (!s) return false;
    const lower = s.toLowerCase();
    if (lower.startsWith("merge branch")) return true;
    if (lower.startsWith("merge ")) return true;
    if (/\bwip\b/i.test(s)) return true;
    return false;
  };
  const commits = noiseEnabled ? commitsRaw.filter((c) => !isNoise(c.subject)) : commitsRaw;

  const messages = buildSummaryMessages({
    title: `速览：${project.name}`,
    rangeLabel: `${preset}`,
    authorPattern,
    projects: [{ name: project.name, path: project.path, commits }],
    aiConfig: cfg.ai,
    features: cfg.features,
  });
  const userContent = messages.find((m) => m.role === "user")?.content ?? "";

  for (;;) {
    const actionChoices = [
      { name: "查看：近期提交内容", value: "commits" },
      { name: "查看：近期我提交的分支", value: "branches" },
      { name: "查看：按日期查看提交", value: "byDay" },
      { name: "查看：按提交类型查看提交", value: "byType" },
        ...(groupingEnabled && hasGroupingRules ? [{ name: "查看：按自定义分组规则查看提交", value: "grouping" }] : []),
      makeBackChoice({ value: "back" }),
    ];
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: `数据速览：${project.name}`,
        choices: actionChoices,
      },
    ]);

    if (action === "back") return;

    if (action === "commits") {
      console.log("");
      console.log(chalk.bold(`## ${project.name} (${project.path})`));
      const overview = formatTable({
        headers: ["字段", "值"],
        rows: [
          ["提交数（当前过滤）", String(commits.length)],
          ["过滤无意义提交", noiseEnabled ? "开" : "关"],
        ],
      });
      console.log(overview);

      const maxRows = 120;
      const rows = commits.slice(0, maxRows).map((c) => [
        String(c.subject ?? "").trim(),
        String(c.author ?? "").trim(),
        String(c.date ?? "").slice(0, 10),
        String(c.hash ?? "").slice(0, 7),
      ]);
      const remaining = commits.length - maxRows;
      if (remaining > 0) rows.push([`... 还有 ${remaining} 条`, "", "", ""]);

      console.log("");
      console.log(
        formatTable({
          headers: ["提交", "作者", "日期", "哈希"],
          rows: rows.length ? rows : [["（无提交）", "", "", ""]],
        }),
      );
      console.log("");
      await pause(inquirer);
      continue;
    }

    if (action === "branches") {
      console.log("");
      console.log(chalk.bold(`## ${project.name} (${project.path})`));
      console.log(`- 时间范围：${formatDateYmd(range.start)} ~ ${formatDateYmd(range.end)}（${preset}）`);
      console.log(`- 作者：${authorPattern}`);
      console.log(`- 提交数（当前过滤）：${commits.length}`);
      if (!commits.length)
        console.log(
          "- 提示：当前作者过滤在该时间范围内未命中提交；可能是作者标识不匹配，或该作者的提交不在当前本地 refs 中（建议先 git fetch，再在 Git Config 中从“近期提交作者”选择）",
        );

      const maxSample = 300;
      const sample = commits.slice(0, maxSample);
      const byBranch = new Map<string, { name: string; commitCount: number; lastDate: string; lastSubject: string }>();
      const remotes = listGitRemotes(project.path);
      const canonicalBranchName = (raw: string) => {
        let n = String(raw ?? "").trim();
        if (!n) return "";
        n = n.replace(/^remotes\//, "");
        for (const r of remotes) {
          const prefix = `${r}/`;
          if (n.startsWith(prefix)) return n.slice(prefix.length);
        }
        return n;
      };

      for (const c of sample) {
        const date = String(c.date ?? "");
        const subject = String(c.subject ?? "");
        const namesRaw = branchesContainingCommit({ repoPath: project.path, hash: c.hash, includeRemotes: true });
        const names = uniqueSorted(namesRaw.map((n) => canonicalBranchName(String(n ?? ""))).filter(Boolean));
        for (const name of names) {
          const entry = byBranch.get(name) ?? { name, commitCount: 0, lastDate: "", lastSubject: "" };
          entry.commitCount += 1;
          if (!entry.lastDate || new Date(date).getTime() >= new Date(entry.lastDate).getTime()) {
            entry.lastDate = date;
            entry.lastSubject = subject;
          }
          byBranch.set(name, entry);
        }
      }

      const rows = Array.from(byBranch.values())
        .sort((a, b) => b.commitCount - a.commitCount || new Date(b.lastDate).getTime() - new Date(a.lastDate).getTime() || a.name.localeCompare(b.name))
        .slice(0, 80)
        .map((e) => [e.name, String(e.commitCount), String(e.lastDate).slice(0, 10), e.lastSubject]);

      if (!rows.length) {
        console.log("- 近期我提交的分支：无");
      } else {
        console.log("");
        console.log(formatTable({ headers: ["分支", "提交数", "最近提交日期", "最近提交摘要"], rows }));
      }
      if (commits.length > sample.length) console.log(`\n- 提示：提交过多，仅取前 ${sample.length} 条提交做分支统计（避免太慢）`);
      console.log("");
      await pause(inquirer);
      continue;
    }

    if (action === "byDay") {
      const dayRe = /^\d{4}-\d{2}-\d{2}$/;
      const byDay = new Map<string, Array<{ subject: string; author: string; date: string; hash: string }>>();
      for (const c of commits) {
        const day = String(c.date ?? "").slice(0, 10);
        const key = dayRe.test(day) ? day : "unknown";
        const entry = byDay.get(key) ?? [];
        entry.push({ subject: String(c.subject ?? ""), author: String(c.author ?? ""), date: String(c.date ?? ""), hash: String(c.hash ?? "") });
        byDay.set(key, entry);
      }

      const keys = Array.from(byDay.keys()).sort((a, b) => {
        if (a === "unknown") return 1;
        if (b === "unknown") return -1;
        return b.localeCompare(a);
      });
      const rows = keys.map((k) => [k, String((byDay.get(k) ?? []).length)]);
      console.log("");
      console.log(chalk.bold(`## ${project.name} (${project.path})`));
      console.log(formatTable({ headers: ["日期", "提交数"], rows: rows.length ? rows : [["（无）", "0"]] }));
      console.log("");

      const choices = keys.map((k) => makeCliChoice({ title: k, stats: (byDay.get(k) ?? []).length, value: k }));
      choices.push(makeBackChoice({ value: "__back__" }));
      for (;;) {
        const { picked } = await inquirer.prompt([{ type: "list", name: "picked", loop: false, message: "选择日期查看提交", choices }]);
        if (picked === "__back__") break;
        const items = byDay.get(String(picked)) ?? [];
        const maxRows = 200;
        const listRows = items.slice(0, maxRows).map((it) => [
          String(it.subject ?? "").trim(),
          String(it.author ?? "").trim(),
          String(it.date ?? "").slice(0, 10),
          String(it.hash ?? "").slice(0, 7),
        ]);
        const remaining = items.length - maxRows;
        if (remaining > 0) listRows.push([`... 还有 ${remaining} 条`, "", "", ""]);
        console.log("");
        console.log(chalk.bold(`## ${String(picked)}（${items.length}）`));
        console.log(formatTable({ headers: ["提交", "作者", "日期", "哈希"], rows: listRows.length ? listRows : [["（无提交）", "", "", ""]] }));
        console.log("");
        await pause(inquirer);
      }
      continue;
    }

    if (action === "byType") {
      const byType = new Map<string, Array<{ subject: string; author: string; date: string; hash: string }>>();
      for (const c of commits) {
        const t = inferCommitTypeFromSubject(String(c.subject ?? ""));
        const entry = byType.get(t) ?? [];
        entry.push({ subject: String(c.subject ?? ""), author: String(c.author ?? ""), date: String(c.date ?? ""), hash: String(c.hash ?? "") });
        byType.set(t, entry);
      }

      const keys = Array.from(byType.keys()).sort((a, b) => {
        const ca = (byType.get(a) ?? []).length;
        const cb = (byType.get(b) ?? []).length;
        return cb - ca || a.localeCompare(b);
      });
      const rows = keys.map((k) => [k, String((byType.get(k) ?? []).length)]);
      console.log("");
      console.log(chalk.bold(`## ${project.name} (${project.path})`));
      console.log(formatTable({ headers: ["类型", "提交数"], rows: rows.length ? rows : [["（无）", "0"]] }));
      console.log("");

      const choices = keys.map((k) => makeCliChoice({ title: k, stats: (byType.get(k) ?? []).length, value: k }));
      choices.push(makeBackChoice({ value: "__back__" }));
      for (;;) {
        const { picked } = await inquirer.prompt([{ type: "list", name: "picked", loop: false, message: "选择类型查看提交", choices }]);
        if (picked === "__back__") break;
        const items = byType.get(String(picked)) ?? [];
        const maxRows = 200;
        const listRows = items.slice(0, maxRows).map((it) => [
          String(it.subject ?? "").trim(),
          String(it.author ?? "").trim(),
          String(it.date ?? "").slice(0, 10),
          String(it.hash ?? "").slice(0, 7),
        ]);
        const remaining = items.length - maxRows;
        if (remaining > 0) listRows.push([`... 还有 ${remaining} 条`, "", "", ""]);
        console.log("");
        console.log(chalk.bold(`## ${String(picked)}（${items.length}）`));
        console.log(formatTable({ headers: ["提交", "作者", "日期", "哈希"], rows: listRows.length ? listRows : [["（无提交）", "", "", ""]] }));
        console.log("");
        await pause(inquirer);
      }
      continue;
    }

    if (action === "grouping") {
      if (!groupingEnabled || !hasGroupingRules) {
        console.log("未配置可用的分组规则。");
        console.log("建议：进入“其他配置” -> “管理：提交分组规则” -> “快速开始（推荐）”，先生成一条规则跑起来。");
        await pause(inquirer);
        continue;
      }

      const defaultRuleId = String(groupingCfg.defaultRuleId ?? "").trim();
      const defaultRule = enabledRules.find((r) => r.id === defaultRuleId) ?? enabledRules[0];
      const { ruleId } = await inquirer.prompt([
        {
          type: "list",
          name: "ruleId",
          loop: false,
          message: "选择分组规则",
          choices: enabledRules.map((r) => makeCliChoice({ title: String(r.name ?? "").trim() || r.id, stats: r.name ? r.id : "", value: r.id })),
          default: defaultRule ? enabledRules.findIndex((r) => r.id === defaultRule.id) : 0,
        },
      ]);
      const rule = enabledRules.find((r) => r.id === ruleId) ?? defaultRule;
      if (!rule) {
        console.log("未找到分组规则。");
        await pause(inquirer);
        continue;
      }

      const branchesContainsEnabled = Boolean((groupingCfg as any)?.branchesContainsEnabled);
      if (ruleNeedsBranches(rule) && !branchesContainsEnabled) {
        console.log("");
        console.log("提示：该分组规则依赖“分支 contains 推断”，但当前已关闭（默认）。");
        console.log("当前分组会退化为仅基于 subject 推断，可能出现大量 unknown。");
        console.log("如需启用：其他配置 -> 管理：提交分组规则 -> 开关：启用分支 contains 推断（很慢）。");
        console.log("");
      }
      const groups = groupCommitsByRule(commits, { rule, repoPath: project.path, branchesContainsEnabled });
      const unknownKey = String(rule.unknownKey ?? "unknown").trim() || "unknown";
      const choices = groups
        .filter((g) => g.key !== unknownKey)
        .slice(0, 60)
        .map((g) => makeCliChoice({ title: g.displayKey, stats: g.total, value: g.key }));
      choices.push(makeCliChoice({ title: unknownKey, status: "未匹配", value: unknownKey }));
      choices.push(makeBackChoice({ value: "__back__" }));

      for (;;) {
        const { picked } = await inquirer.prompt([{ type: "list", name: "picked", loop: false, message: "选择一个分组查看提交", choices }]);
        if (picked === "__back__") break;
        const g = groups.find((x) => x.key === picked);
        console.log("");
        console.log(chalk.bold(`## ${g ? g.displayKey : String(picked)}`));
        for (const it of (g?.items ?? []).slice(0, 200)) {
          console.log(`- ${it.subject} (${it.author}, ${it.date.slice(0, 10)}, ${it.hash.slice(0, 7)})`);
        }
        const remaining = (g?.items ?? []).length - 200;
        if (remaining > 0) console.log(`- ... 还有 ${remaining} 条`);
        console.log("");
        await pause(inquirer);
      }
      continue;
    }

    if (action === "prompt") {
      console.log("");
      const maxChars = 24000;
      if (userContent.length <= maxChars) console.log(userContent);
      else console.log(userContent.slice(0, maxChars) + "\n\n（已截断：内容过长）");
      console.log("");
      await pause(inquirer);
      continue;
    }
  }
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
      choices: candidates.map((p) => makeCliChoice({ title: path.basename(p), stats: p, value: p })),
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
          { name: "速览数据", value: "preview" },
          makeBackChoice({ title: "返回列表", value: "back" }),
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

    if (action === "preview") {
      await previewProjectDataInteractive(inquirer, current);
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
          makeCliChoice({ title: "项目列表", stats: config.projects.length, description: "选择编辑/删除", value: "list" }),
          { name: "手动添加指定项目", value: "add" },
          { name: "扫描目录并导入项目", value: "scan" },
          makeBackChoice({ value: "back" }),
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
