import { readTextFileIfExists } from "../utils/fs.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Prompt = {
  name: string;
  system: string;
  requirements: string[];
};

export type ChatMessage = { role: "system" | "user"; content: string };

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
  ...loadPromptsFromDir(path.join(__dirname, "pormpts")),
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
  if (skills) parts.push(`\n\n### Skills\n\n${skills}`);
  return parts.join("");
}

type CommitLike = { subject?: unknown; author?: unknown; date?: unknown; hash?: unknown };
type ProjectWithCommitsLike = { name?: unknown; commits?: CommitLike[] | unknown };

function buildUserContent(input: {
  title: string;
  rangeLabel: string;
  authorPattern: string;
  projects: ProjectWithCommitsLike[];
  requirements: string[];
}): string {
  const authorLine = String(input.authorPattern ?? "").trim()
    ? `提交人过滤：${String(input.authorPattern).trim()}`
    : "提交人过滤：无（全员）";
  const lines: string[] = [];
  lines.push(`标题：${input.title}`);
  lines.push(`范围：${input.rangeLabel}`);
  lines.push(authorLine);
  lines.push("");
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
}): ChatMessage[] {
  const promptCfg = resolvePromptConfig(input.aiConfig);
  const builtin = getBuiltinPrompt(promptCfg.promptId);
  const system = buildSystemPrompt(promptCfg);
  const user = buildUserContent({
    title: input.title,
    rangeLabel: input.rangeLabel,
    authorPattern: input.authorPattern ?? "",
    projects: input.projects,
    requirements: builtin.requirements,
  });
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
