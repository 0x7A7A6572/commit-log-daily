import { summarizeLocally, summarizeWithAi, isAiConfigured } from "../ai.js";
import { readGitLog, type DateRange, type GitCommit } from "../git.js";
import { loadConfig, type AiConfig, type Project } from "../config.js";

export type ProjectWithCommits = Project & { commits: GitCommit[] };
export type CollectCommitsError = { name: string; path: string; message: string };

export function collectCommits(input: { projects: Project[]; range: DateRange; authorPattern: string }): {
  projectsWithCommits: ProjectWithCommits[];
  errors: CollectCommitsError[];
} {
  const selectedProjects = Array.isArray(input.projects) ? input.projects : [];
  const projectsWithCommits: ProjectWithCommits[] = [];
  const errors: CollectCommitsError[] = [];
  const cfg = loadConfig();
  const filterNoise = Boolean(cfg?.git?.filterNoise);
  const isNoise = (subject: unknown) => {
    const s = String(subject ?? "").trim();
    if (!s) return false;
    const lower = s.toLowerCase();
    if (lower.startsWith("merge branch")) return true;
    if (lower.startsWith("merge ")) return true;
    if (/\bWIP\b/i.test(s)) return true;
    return false;
  };

  for (const p of selectedProjects) {
    try {
      const commits = readGitLog({
        repoPath: p.path,
        start: input.range.start,
        end: input.range.end,
        authorPattern: input.authorPattern,
      });
      const cleaned = filterNoise ? commits.filter((c) => !isNoise(c.subject)) : commits;
      projectsWithCommits.push({ name: p.name, path: p.path, commits: cleaned });
    } catch (e) {
      errors.push({ name: p.name, path: p.path, message: String((e as any)?.message ?? e) });
      projectsWithCommits.push({ name: p.name, path: p.path, commits: [] });
    }
  }

  return { projectsWithCommits, errors };
}

export async function buildReportContent(input: {
  title: string;
  rangeLabel: string;
  authorPattern: string;
  projectsWithCommits: ProjectWithCommits[];
  useAi: boolean;
  aiConfig: AiConfig;
  stream?: boolean;
  onAiToken?: ((token: string) => void) | null;
}): Promise<{ content: string; usedAi: boolean; aiError: string }> {
  const aiAvailable = isAiConfigured(input.aiConfig);
  if (!input.useAi) {
    return {
      content: summarizeLocally({
        title: input.title,
        rangeLabel: input.rangeLabel,
        authorPattern: input.authorPattern,
        projects: input.projectsWithCommits,
      }),
      usedAi: false,
      aiError: "",
    };
  }

  if (!aiAvailable) {
    return {
      content: summarizeLocally({
        title: input.title,
        rangeLabel: input.rangeLabel,
        authorPattern: input.authorPattern,
        projects: input.projectsWithCommits,
      }),
      usedAi: false,
      aiError: "AI 未配置",
    };
  }

  try {
    const content = await summarizeWithAi({
      title: input.title,
      rangeLabel: input.rangeLabel,
      authorPattern: input.authorPattern,
      projects: input.projectsWithCommits,
      aiConfig: input.aiConfig,
      stream: input.stream ?? false,
      onToken: input.onAiToken ?? null,
    });
    return { content, usedAi: true, aiError: "" };
  } catch (e) {
    const aiError = String((e as any)?.message ?? e ?? "").trim() || "AI 请求失败";
    return {
      content: summarizeLocally({
        title: input.title,
        rangeLabel: input.rangeLabel,
        authorPattern: input.authorPattern,
        projects: input.projectsWithCommits,
      }),
      usedAi: false,
      aiError,
    };
  }
}
