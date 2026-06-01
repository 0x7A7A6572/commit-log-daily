import { readTextFileIfExists } from "../utils/fs.js";
import { groupCommitsByRule, ruleNeedsBranches, type GroupingRule } from "../utils/grouping.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Prompt = {
  name: string;
  system: string;
  requirements: string[];
};

export type ChatMessage = { role: "system" | "user"; content: string };

type CommitAnalytics = {
  total: number;
  byType: Array<{ type: string; count: number }>;
  byScope: Array<{ scope: string; count: number }>;
  byDay: Array<{ day: string; count: number }>;
};

function loadPromptsFromDir(dirPath: unknown): Record<string, Prompt> {
  const dir = String(dirPath ?? "").trim();
  if (!dir) return {};
  try {
    if (!fs.existsSync(dir)) return {};
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const mdFiles = entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((name) => name.toLowerCase().endsWith(".md"));

    const prompts: Record<string, Prompt> = {};
    for (const fileName of mdFiles) {
      const id = path.basename(fileName, path.extname(fileName)).trim();
      if (!id) continue;
      const content = readTextFileIfExists(path.join(dir, fileName)).trim();
      if (!content) continue;
      prompts[id] = { name: id, system: content, requirements: [] };
    }
    return prompts;
  } catch {
    return {};
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE_PROMPTS = {
  ...loadPromptsFromDir(path.join(__dirname, "prompts")),
};

const BUILTIN_PROMPTS: Record<string, Prompt> = {
  default: {
    name: "默认",
    system:
      "你是一个工程团队助手。你会把原始 git 提交记录整理成高质量的日报/周报/月报/年报。输出必须是中文 Markdown，内容简洁、可读、可复制。",
    requirements: [
      "1) 给一个总览（1-5条要点）",
      "2) 按项目分别总结（每个项目 3-8 条）",
      "3) 提炼潜在风险/阻塞点（如果看不出来就写“暂无明显风险”）",
      "4) 给出下一步建议（3-6条）",
    ],
  },
  ...FILE_PROMPTS,
};

export function listPromptChoices(): Array<{ id: string; name: string }> {
  const entries = Object.entries(BUILTIN_PROMPTS).map(([id, p]) => ({ id, name: p.name }));
  const head = entries.filter((e) => e.id === "default");
  const rest = entries
    .filter((e) => e.id !== "default")
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return [...head, ...rest];
}

export function resolvePromptConfig(aiConfig: unknown): { promptId: string; promptPath: string; skillsPath: string } {
  const cfg = typeof aiConfig === "object" && aiConfig ? (aiConfig as Record<string, unknown>) : {};
  const promptId = String((cfg.promptId ?? (cfg.prompt as Record<string, unknown> | undefined)?.id ?? "default") as unknown)
    .trim() || "default";
  const promptPath = String((cfg.promptPath ?? (cfg.prompt as Record<string, unknown> | undefined)?.path ?? "") as unknown).trim();
  const skillsPath = String((cfg.skillsPath ?? (cfg.skills as Record<string, unknown> | undefined)?.path ?? "") as unknown).trim();
  return { promptId, promptPath, skillsPath };
}

function getBuiltinPrompt(promptId: unknown): Prompt {
  const key = String(promptId ?? "").trim();
  return BUILTIN_PROMPTS[key] ?? BUILTIN_PROMPTS.default;
}

function buildSystemPrompt(input: { promptId: string; promptPath: string; skillsPath: string }): string {
  const custom = readTextFileIfExists(input.promptPath).trim();
  const builtin = getBuiltinPrompt(input.promptId).system;
  const skills = readTextFileIfExists(input.skillsPath).trim();

  const parts: string[] = [];
  parts.push(custom || builtin);
  if (custom) {
    parts.push(
      "\n\n### Hard Constraints\n\n" +
        "- 输出必须严格遵循用户在 Prompt 中声明的结构与字段名。\n" +
        "- 禁止编造事实；只能基于输入中的“派生分析”和“原始提交记录”。无法推断就写 unknown/暂无。\n" +
        "- 避免空话（例如“完成关键功能”）；每条结论要能对应到输入中的具体线索（类型/分组/提交主题）。\n",
    );
  }
  if (skills) parts.push(`\n\n### Skills\n\n${skills}`);
  return parts.join("");
}

type CommitLike = { subject?: unknown; author?: unknown; date?: unknown; hash?: unknown };
type ProjectWithCommitsLike = { name?: unknown; path?: unknown; commits?: CommitLike[] | unknown };

function topEntries(map: Map<string, number>, limit: number): Array<{ key: string; count: number }> {
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .filter((e) => e.key && Number.isFinite(e.count) && e.count > 0)
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)))
    .slice(0, Math.max(0, Math.floor(limit)));
}

function parseConventionalSubject(subject: string): { type: string; scope: string; breaking: boolean; summary: string } | null {
  const s = String(subject ?? "").trim();
  if (!s) return null;
  const m = s.match(/^([a-zA-Z]+)(\(([^)]+)\))?(!)?:\s+(.+)$/);
  if (!m) return null;
  const type = String(m[1] ?? "").trim().toLowerCase();
  const scope = String(m[3] ?? "").trim();
  const breaking = Boolean(m[4]);
  const summary = String(m[5] ?? "").trim();
  if (!type || !summary) return null;
  return { type, scope, breaking, summary };
}

function inferCommitType(subject: unknown): string {
  const s = String(subject ?? "").trim();
  const parsed = parseConventionalSubject(s);
  if (parsed) return parsed.breaking ? `${parsed.type}!` : parsed.type;
  const loose = s.match(/^([a-zA-Z]+)\s*:\s+/);
  if (loose) return String(loose[1] ?? "").trim().toLowerCase();
  if (/^merge\b/i.test(s)) return "merge";
  return "other";
}

function inferCommitScope(subject: unknown): string {
  const parsed = parseConventionalSubject(String(subject ?? "").trim());
  return parsed?.scope ?? "";
}

type GroupingAgg = {
  key: string;
  displayKey: string;
  total: number;
  byType: Array<{ type: string; count: number }>;
  projects: Array<{ project: string; count: number }>;
  examples: string[];
  suggestedWorkType: string;
};

function inferWorkTypeFromAgg(input: { key: string; byType: Array<{ type: string; count: number }> }): string {
  const key = String(input.key ?? "").trim();
  if (key.startsWith("release/")) return "迭代验收";
  const types = new Set(input.byType.map((e) => String(e.type ?? "").trim().toLowerCase()).filter(Boolean));
  if (types.has("feat") || types.has("feature") || types.has("build")) return "迭代研发";
  if (types.has("fix") || types.has("bugfix") || types.has("hotfix")) return "问题修复";
  if (types.has("perf") || types.has("refactor") || types.has("chore")) return "技术优化";
  return "其他";
}

function buildGroupingAggs(projects: ProjectWithCommitsLike[], rule: GroupingRule, branchesContainsEnabled: boolean): GroupingAgg[] {
  type GroupState = {
    total: number;
    byType: Map<string, number>;
    byProject: Map<string, number>;
    examples: string[];
    displayKey: string;
  };
  const groups = new Map<string, GroupState>();

  for (const p of Array.isArray(projects) ? projects : []) {
    const projectName = String(p?.name ?? "").trim() || "unknown";
    const repoPath = String(p?.path ?? "").trim();
    const commits = Array.isArray(p?.commits) ? (p.commits as CommitLike[]) : [];
    if (!repoPath || !commits.length) continue;
    const normalized = commits.map((c) => ({
      subject: String(c?.subject ?? ""),
      author: String(c?.author ?? ""),
      date: String(c?.date ?? ""),
      hash: String(c?.hash ?? ""),
    }));
    const grouped = groupCommitsByRule(normalized, { rule, repoPath, branchesContainsEnabled });
    for (const g of grouped) {
      const entry =
        groups.get(g.key) ??
        ({
          total: 0,
          byType: new Map<string, number>(),
          byProject: new Map<string, number>(),
          examples: [],
          displayKey: g.displayKey,
        } satisfies GroupState);

      entry.total += g.total;
      entry.byProject.set(projectName, (entry.byProject.get(projectName) ?? 0) + g.total);
      for (const it of g.items) {
        const subject = String(it.subject ?? "").trim();
        const t = inferCommitType(subject);
        entry.byType.set(t, (entry.byType.get(t) ?? 0) + 1);
        if (subject && entry.examples.length < 5 && !entry.examples.includes(subject)) entry.examples.push(subject);
      }
      groups.set(g.key, entry);
    }
  }

  const out: GroupingAgg[] = [];
  for (const [key, g] of groups.entries()) {
    const byType = topEntries(g.byType, 12).map((e) => ({ type: e.key, count: e.count }));
    const projects = topEntries(g.byProject, 12).map((e) => ({ project: e.key, count: e.count }));
    out.push({
      key,
      displayKey: g.displayKey,
      total: g.total,
      byType,
      projects,
      examples: g.examples,
      suggestedWorkType: inferWorkTypeFromAgg({ key, byType }),
    });
  }

  return out.sort((a, b) => b.total - a.total || String(a.key).localeCompare(String(b.key)));
}

function buildAnalytics(commits: CommitLike[]): CommitAnalytics {
  const safeCommits = Array.isArray(commits) ? commits : [];
  const byType = new Map<string, number>();
  const byScope = new Map<string, number>();
  const byDay = new Map<string, number>();

  for (const c of safeCommits) {
    const subject = String(c?.subject ?? "").trim();
    const t = inferCommitType(subject);
    byType.set(t, (byType.get(t) ?? 0) + 1);

    const scope = inferCommitScope(subject);
    if (scope) byScope.set(scope, (byScope.get(scope) ?? 0) + 1);

    const day = String(c?.date ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }

  const byTypeArr = topEntries(byType, 12).map((e) => ({ type: e.key, count: e.count }));
  const byScopeArr = topEntries(byScope, 12).map((e) => ({ scope: e.key, count: e.count }));
  const byDayArr = topEntries(byDay, 14).map((e) => ({ day: e.key, count: e.count }));

  return {
    total: safeCommits.length,
    byType: byTypeArr,
    byScope: byScopeArr,
    byDay: byDayArr,
  };
}

function resolveGroupingRule(features: any): GroupingRule | null {
  const cfg = (features ?? {}) as any;
  const grouping = cfg.grouping ?? null;
  if (grouping && grouping.enabled === false) return null;
  const rules = (Array.isArray(grouping?.rules) ? grouping.rules : []).filter((r: any) => r && r.enabled);
  if (!rules.length) return null;
  const defaultRuleId = String(grouping?.defaultRuleId ?? "").trim();
  const picked = rules.find((r: any) => String(r.id ?? "") === defaultRuleId) ?? rules[0];
  if (!picked) return null;
  return picked as GroupingRule;
}

function buildUserContent(input: {
  title: string;
  rangeLabel: string;
  authorPattern: string;
  projects: ProjectWithCommitsLike[];
  requirements: string[];
  groupingRule: GroupingRule | null;
  branchesContainsEnabled: boolean;
}): string {
  const authorLine = String(input.authorPattern ?? "").trim()
    ? `提交人过滤：${String(input.authorPattern).trim()}`
    : "提交人过滤：无（全员）";
  const lines: string[] = [];
  lines.push(`标题：${input.title}`);
  lines.push(`范围：${input.rangeLabel}`);
  lines.push(authorLine);
  lines.push("");
  const allCommits = input.projects.flatMap((p) => (Array.isArray(p.commits) ? p.commits : []));
  const globalAnalytics = buildAnalytics(allCommits);
  lines.push("派生分析（辅助你按不同维度写报告；基于提交信息推断，可能不完全准确）：");
  lines.push(`- 总提交数：${globalAnalytics.total}`);
  if (globalAnalytics.byType.length) {
    lines.push(`- 按提交类型：${globalAnalytics.byType.map((e) => `${e.type} ${e.count}`).join("，")}`);
  }
  if (globalAnalytics.byDay.length) {
    lines.push(`- 按日期分布（Top）：${globalAnalytics.byDay.map((e) => `${e.day} ${e.count}`).join("，")}`);
  }
  lines.push("");

  if (input.groupingRule) {
    if (ruleNeedsBranches(input.groupingRule) && !input.branchesContainsEnabled) {
      lines.push("提示：当前“分支 contains 推断”已关闭（性能原因）。若分组规则依赖 branches/builtin，会退化为仅基于提交主题 subject 推断，可能出现大量 unknown。");
      lines.push("");
    }
    const aggs = buildGroupingAggs(input.projects, input.groupingRule, input.branchesContainsEnabled);
    if (aggs.length) {
      lines.push(`跨项目分组（按规则 key 聚合；规则：${input.groupingRule.name || input.groupingRule.id}）：`);
      for (const g of aggs.slice(0, 30)) {
        const proj = g.projects.length ? g.projects.map((p) => `${p.project} ${p.count}`).join("，") : "";
        const types = g.byType.length ? g.byType.map((t) => `${t.type} ${t.count}`).join("，") : "";
        const ex = g.examples.length ? g.examples.slice(0, 3).join(" / ") : "";
        lines.push(`- ${g.displayKey}：${g.total}；类型：${g.suggestedWorkType}${types ? `；提交类型分布：${types}` : ""}${proj ? `；涉及项目：${proj}` : ""}`);
        if (ex) lines.push(`  - 例：${ex}`);
      }
      lines.push("");
    }
  }

  lines.push("原始提交记录（按项目分组）：");
  lines.push("");
  for (const p of input.projects) {
    lines.push(`## ${String(p.name ?? "")}`);
    const commits = Array.isArray(p.commits) ? p.commits : [];
    if (!commits.length) {
      lines.push("- （无提交）");
      lines.push("");
      continue;
    }

    const analytics = buildAnalytics(commits);
    lines.push(`- 提交数：${analytics.total}`);
    if (analytics.byType.length) lines.push(`- 类型：${analytics.byType.map((e) => `${e.type} ${e.count}`).join("，")}`);
    if (analytics.byScope.length) lines.push(`- scope：${analytics.byScope.map((e) => `${e.scope} ${e.count}`).join("，")}`);
    if (input.groupingRule && String(p?.path ?? "").trim()) {
      const repoPath = String(p.path ?? "").trim();
      const normalized = commits.map((c) => ({
        subject: String((c as any)?.subject ?? ""),
        author: String((c as any)?.author ?? ""),
        date: String((c as any)?.date ?? ""),
        hash: String((c as any)?.hash ?? ""),
      }));
      const groups = groupCommitsByRule(normalized, { rule: input.groupingRule, repoPath, branchesContainsEnabled: input.branchesContainsEnabled });
      if (groups.length) {
        lines.push("- 分组（Top）：");
        for (const g of groups.slice(0, 12)) {
          const ex = g.items.length ? `；例：${g.items.slice(0, 3).map((it) => String(it.subject ?? "").trim()).filter(Boolean).join(" / ")}` : "";
          lines.push(`  - ${g.displayKey}：${g.total}${ex}`);
        }
      }
    }
    if (analytics.byDay.length) lines.push(`- 日期分布（Top）：${analytics.byDay.map((e) => `${e.day} ${e.count}`).join("，")}`);
    lines.push("");

    for (const c of commits) {
      lines.push(`- ${String(c.subject ?? "")} (${String(c.author ?? "")}, ${String(c.date ?? "")}, ${String(c.hash ?? "").slice(0, 7)})`);
    }
    lines.push("");
  }
  const reqs = Array.isArray(input.requirements) ? input.requirements : [];
  if (reqs.length) {
    lines.push("输出要求：");
    for (const r of reqs) lines.push(r);
  }
  return lines.join("\n");
}

export function buildSummaryMessages(input: {
  title: string;
  rangeLabel: string;
  authorPattern?: string;
  projects: ProjectWithCommitsLike[];
  aiConfig: unknown;
  features?: any | null;
}): ChatMessage[] {
  const promptCfg = resolvePromptConfig(input.aiConfig);
  const builtin = getBuiltinPrompt(promptCfg.promptId);
  const hasCustomPrompt = Boolean(readTextFileIfExists(promptCfg.promptPath).trim());
  const system = buildSystemPrompt(promptCfg);
  const groupingRule = resolveGroupingRule(input.features);
  const branchesContainsEnabled = Boolean((input.features ?? {})?.grouping?.branchesContainsEnabled);
  const user = buildUserContent({
    title: input.title,
    rangeLabel: input.rangeLabel,
    authorPattern: input.authorPattern ?? "",
    projects: input.projects,
    requirements: hasCustomPrompt ? [] : builtin.requirements,
    groupingRule,
    branchesContainsEnabled,
  });
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
