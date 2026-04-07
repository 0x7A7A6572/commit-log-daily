import { summarizeLocally, summarizeWithAi, isAiConfigured } from "../ai.js";
import { readGitLog } from "../git.js";

export function collectCommits({ projects, range, authorPattern }) {
  const selectedProjects = Array.isArray(projects) ? projects : [];
  const projectsWithCommits = [];
  const errors = [];

  for (const p of selectedProjects) {
    try {
      const commits = readGitLog({
        repoPath: p.path,
        start: range.start,
        end: range.end,
        authorPattern,
      });
      projectsWithCommits.push({ name: p.name, path: p.path, commits });
    } catch (e) {
      errors.push({ name: p.name, path: p.path, message: String(e?.message ?? e) });
      projectsWithCommits.push({ name: p.name, path: p.path, commits: [] });
    }
  }

  return { projectsWithCommits, errors };
}

export async function buildReportContent({ title, rangeLabel, authorPattern, projectsWithCommits, useAi, aiConfig, stream = false, onAiToken = null }) {
  const aiAvailable = isAiConfigured(aiConfig);
  if (!useAi) {
    return { content: summarizeLocally({ title, rangeLabel, authorPattern, projects: projectsWithCommits }), usedAi: false, aiError: "" };
  }

  if (!aiAvailable) {
    return { content: summarizeLocally({ title, rangeLabel, authorPattern, projects: projectsWithCommits }), usedAi: false, aiError: "AI 未配置" };
  }

  try {
    const content = await summarizeWithAi({
      title,
      rangeLabel,
      authorPattern,
      projects: projectsWithCommits,
      aiConfig,
      stream,
      onToken: onAiToken,
    });
    return { content, usedAi: true, aiError: "" };
  } catch (e) {
    const aiError = String(e?.message ?? e ?? "").trim() || "AI 请求失败";
    return { content: summarizeLocally({ title, rangeLabel, authorPattern, projects: projectsWithCommits }), usedAi: false, aiError };
  }
}
