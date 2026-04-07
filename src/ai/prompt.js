import { readTextFileIfExists } from "../utils/fs.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function loadPromptsFromDir(dirPath) {
  const dir = String(dirPath ?? "").trim();
  if (!dir) return {};
  try {
    if (!fs.existsSync(dir)) return {};
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const mdFiles = entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((name) => name.toLowerCase().endsWith(".md"));

    const prompts = {};
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

const BUILTIN_PROMPTS = {
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

export function listPromptChoices() {
  const entries = Object.entries(BUILTIN_PROMPTS).map(([id, p]) => ({ id, name: p.name }));
  const head = entries.filter((e) => e.id === "default");
  const rest = entries
    .filter((e) => e.id !== "default")
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return [...head, ...rest];
}

export function resolvePromptConfig(aiConfig) {
  const cfg = typeof aiConfig === "object" && aiConfig ? aiConfig : {};
  const promptId = String(cfg.promptId ?? cfg.prompt?.id ?? "default").trim() || "default";
  const promptPath = String(cfg.promptPath ?? cfg.prompt?.path ?? "").trim();
  const skillsPath = String(cfg.skillsPath ?? cfg.skills?.path ?? "").trim();
  return { promptId, promptPath, skillsPath };
}

function getBuiltinPrompt(promptId) {
  const key = String(promptId ?? "").trim();
  return BUILTIN_PROMPTS[key] ?? BUILTIN_PROMPTS.default;
}

function buildSystemPrompt({ promptId, promptPath, skillsPath }) {
  const custom = readTextFileIfExists(promptPath).trim();
  const builtin = getBuiltinPrompt(promptId).system;
  const skills = readTextFileIfExists(skillsPath).trim();

  const parts = [];
  parts.push(custom || builtin);
  if (skills) parts.push(`\n\n### Skills\n\n${skills}`);
  return parts.join("");
}

function buildUserContent({ title, rangeLabel, authorPattern, projects, requirements }) {
  const authorLine = String(authorPattern ?? "").trim() ? `提交人过滤：${String(authorPattern).trim()}` : "提交人过滤：无（全员）";
  const lines = [];
  lines.push(`标题：${title}`);
  lines.push(`范围：${rangeLabel}`);
  lines.push(authorLine);
  lines.push("");
  lines.push("原始提交记录（按项目分组）：");
  lines.push("");
  for (const p of projects) {
    lines.push(`## ${p.name}`);
    const commits = Array.isArray(p.commits) ? p.commits : [];
    if (!commits.length) {
      lines.push("- （无提交）");
      lines.push("");
      continue;
    }
    for (const c of commits) {
      lines.push(`- ${c.subject} (${c.author}, ${c.date}, ${String(c.hash ?? "").slice(0, 7)})`);
    }
    lines.push("");
  }
  const reqs = Array.isArray(requirements) ? requirements : [];
  if (reqs.length) {
    lines.push("输出要求：");
    for (const r of reqs) lines.push(r);
  }
  return lines.join("\n");
}

export function buildSummaryMessages({ title, rangeLabel, authorPattern = "", projects, aiConfig }) {
  const promptCfg = resolvePromptConfig(aiConfig);
  const builtin = getBuiltinPrompt(promptCfg.promptId);
  const system = buildSystemPrompt(promptCfg);
  const user = buildUserContent({ title, rangeLabel, authorPattern, projects, requirements: builtin.requirements });
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
