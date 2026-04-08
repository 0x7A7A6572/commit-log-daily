import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type Project = { name: string; path: string };

export type GitConfig = { author: string; filterNoise: boolean };

export type ProjectsScanConfig = { rootDir: string; depth: number };

export type AiAuthConfig = { apiKey: string };
export type AiEndpointConfig = { baseUrl: string; model: string; timeoutMs: number; stream: boolean };
export type AiPromptConfig = { id: string; path: string };
export type AiSkillsConfig = { path: string };
export type AiConfig = {
  auth: AiAuthConfig;
  endpoint: AiEndpointConfig;
  prompt: AiPromptConfig;
  skills: AiSkillsConfig;
};

export type ReportOutputMode = "stdout" | "file" | "both";
export type ReportConfig = { outputDir: string; outputMode: ReportOutputMode };

export type AppConfig = {
  version: number;
  projects: Project[];
  git: GitConfig;
  projectsScan: ProjectsScanConfig;
  ai: AiConfig;
  report: ReportConfig;
};

const CONFIG_DIR_NAME = ".commit-log-daily";
const CONFIG_FILE_NAME = "config.json";

export function getConfigFilePath(): string {
  return path.join(os.homedir(), CONFIG_DIR_NAME, CONFIG_FILE_NAME);
}

const DEFAULT_CONFIG: AppConfig = {
  version: 1,
  projects: [],
  git: { author: "", filterNoise: false },
  projectsScan: { rootDir: "", depth: 1 },
  ai: {
    auth: { apiKey: "" },
    endpoint: {
      baseUrl: "https://api.openai.com",
      model: "gpt-4.1-mini",
      timeoutMs: 20000,
      stream: false,
    },
    prompt: { id: "default", path: "" },
    skills: { path: "" },
  },
  report: {
    outputDir: "",
    outputMode: "stdout",
  },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v && typeof v === "object" && !Array.isArray(v));
}

function mergeAiConfig(current: unknown, patch: unknown): Record<string, unknown> {
  const c = isPlainObject(current) ? current : {};
  const p = isPlainObject(patch) ? patch : {};

  const auth = isPlainObject(c.auth) ? c.auth : {};
  const endpoint = isPlainObject(c.endpoint) ? c.endpoint : {};
  const prompt = isPlainObject(c.prompt) ? c.prompt : {};
  const skills = isPlainObject(c.skills) ? c.skills : {};

  const next: Record<string, unknown> = {
    ...c,
    ...(Object.keys(p).some((k) => !["auth", "endpoint", "prompt", "skills"].includes(k)) ? p : {}),
    auth: { ...auth, ...(isPlainObject(p.auth) ? p.auth : {}) },
    endpoint: { ...endpoint, ...(isPlainObject(p.endpoint) ? p.endpoint : {}) },
    prompt: { ...prompt, ...(isPlainObject(p.prompt) ? p.prompt : {}) },
    skills: { ...skills, ...(isPlainObject(p.skills) ? p.skills : {}) },
  };

  const nextAuth = isPlainObject(next.auth) ? next.auth : {};
  const nextEndpoint = isPlainObject(next.endpoint) ? next.endpoint : {};
  const nextPrompt = isPlainObject(next.prompt) ? next.prompt : {};
  const nextSkills = isPlainObject(next.skills) ? next.skills : {};
  next.auth = nextAuth;
  next.endpoint = nextEndpoint;
  next.prompt = nextPrompt;
  next.skills = nextSkills;

  if (Object.prototype.hasOwnProperty.call(p, "apiKey")) nextAuth.apiKey = p.apiKey;
  if (Object.prototype.hasOwnProperty.call(p, "baseUrl")) nextEndpoint.baseUrl = p.baseUrl;
  if (Object.prototype.hasOwnProperty.call(p, "model")) nextEndpoint.model = p.model;
  if (Object.prototype.hasOwnProperty.call(p, "timeoutMs")) nextEndpoint.timeoutMs = p.timeoutMs;
  if (Object.prototype.hasOwnProperty.call(p, "stream")) nextEndpoint.stream = p.stream;
  if (Object.prototype.hasOwnProperty.call(p, "promptId")) nextPrompt.id = p.promptId;
  if (Object.prototype.hasOwnProperty.call(p, "promptPath")) nextPrompt.path = p.promptPath;
  if (Object.prototype.hasOwnProperty.call(p, "skillsPath")) nextSkills.path = p.skillsPath;

  return next;
}

function normalizeConfig(input: unknown): AppConfig {
  const parsed = isPlainObject(input) ? input : {};

  const projects = Array.isArray(parsed.projects) ? parsed.projects : [];
  const normalizedProjects: Project[] = projects
    .filter((p): p is Record<string, unknown> => isPlainObject(p))
    .map((p) => ({ name: String(p.name ?? "").trim(), path: String(p.path ?? "").trim() }))
    .filter((p) => p.name && p.path);

  const git = isPlainObject(parsed.git) ? parsed.git : {};
  const author = String(git.author ?? "").trim();
  const filterNoiseRaw = Object.prototype.hasOwnProperty.call(git, "filterNoise") ? git.filterNoise : false;
  const filterNoise =
    filterNoiseRaw === true ||
    String(filterNoiseRaw ?? "")
      .trim()
      .toLowerCase() === "true" ||
    String(filterNoiseRaw ?? "")
      .trim()
      .toLowerCase() === "1";

  const projectsScan = isPlainObject(parsed.projectsScan) ? parsed.projectsScan : {};
  const scanRootDir = String(projectsScan.rootDir ?? DEFAULT_CONFIG.projectsScan.rootDir).trim();
  const scanDepthRaw = Number(projectsScan.depth ?? DEFAULT_CONFIG.projectsScan.depth);
  const scanDepth =
    Number.isFinite(scanDepthRaw) && scanDepthRaw >= 0 ? Math.floor(scanDepthRaw) : DEFAULT_CONFIG.projectsScan.depth;

  const ai = isPlainObject(parsed.ai) ? parsed.ai : {};
  const authObj = isPlainObject(ai.auth) ? ai.auth : {};
  const endpointObj = isPlainObject(ai.endpoint) ? ai.endpoint : {};
  const promptObj = isPlainObject(ai.prompt) ? ai.prompt : {};
  const skillsObj = isPlainObject(ai.skills) ? ai.skills : {};

  const apiKey = String(ai.apiKey ?? authObj.apiKey ?? "").trim();
  const baseUrl =
    String(ai.baseUrl ?? endpointObj.baseUrl ?? DEFAULT_CONFIG.ai.endpoint.baseUrl).trim() || DEFAULT_CONFIG.ai.endpoint.baseUrl;
  const model = String(ai.model ?? endpointObj.model ?? DEFAULT_CONFIG.ai.endpoint.model).trim() || DEFAULT_CONFIG.ai.endpoint.model;

  const timeoutMsRaw = Number(ai.timeoutMs ?? endpointObj.timeoutMs ?? DEFAULT_CONFIG.ai.endpoint.timeoutMs);
  const timeoutMs =
    Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? Math.floor(timeoutMsRaw) : DEFAULT_CONFIG.ai.endpoint.timeoutMs;

  const streamRaw = Object.prototype.hasOwnProperty.call(ai, "stream") ? ai.stream : endpointObj.stream;
  const stream =
    streamRaw === true ||
    String(streamRaw ?? "")
      .trim()
      .toLowerCase() === "true" ||
    String(streamRaw ?? "")
      .trim()
      .toLowerCase() === "1";

  const promptId = String(ai.promptId ?? promptObj.id ?? DEFAULT_CONFIG.ai.prompt.id).trim() || DEFAULT_CONFIG.ai.prompt.id;
  const promptPath = String(ai.promptPath ?? promptObj.path ?? "").trim();
  const skillsPath = String(ai.skillsPath ?? skillsObj.path ?? "").trim();

  const reportObj = isPlainObject(parsed.report) ? parsed.report : {};
  const outputDir = String(reportObj.outputDir ?? "").trim();
  const outputModeRaw = String(reportObj.outputMode ?? DEFAULT_CONFIG.report.outputMode).trim();
  const outputMode: ReportOutputMode = (["stdout", "file", "both"] as const).includes(outputModeRaw as ReportOutputMode)
    ? (outputModeRaw as ReportOutputMode)
    : DEFAULT_CONFIG.report.outputMode;

  return {
    ...DEFAULT_CONFIG,
    version: Number(parsed.version ?? DEFAULT_CONFIG.version) || DEFAULT_CONFIG.version,
    projects: normalizedProjects,
    git: { author, filterNoise },
    projectsScan: { rootDir: scanRootDir, depth: scanDepth },
    ai: {
      auth: { apiKey },
      endpoint: { baseUrl, model, timeoutMs, stream },
      prompt: { id: promptId, path: promptPath },
      skills: { path: skillsPath },
    },
    report: { outputDir, outputMode },
  };
}

function ensureConfigDirExists(): void {
  const configFilePath = getConfigFilePath();
  const dir = path.dirname(configFilePath);
  fs.mkdirSync(dir, { recursive: true });
}

export function loadConfig(): AppConfig {
  const configFilePath = getConfigFilePath();
  try {
    const raw = fs.readFileSync(configFilePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return normalizeConfig(parsed);
  } catch {
    return normalizeConfig(null);
  }
}

export function saveConfig(config: unknown): void {
  ensureConfigDirExists();
  const configFilePath = getConfigFilePath();
  const normalized = normalizeConfig(config);
  fs.writeFileSync(configFilePath, JSON.stringify(normalized, null, 2), "utf8");
}

export function upsertProject(input: { name: unknown; repoPath: unknown }): Project {
  const config = loadConfig();
  const trimmedName = String(input.name ?? "").trim();
  const trimmedPath = String(input.repoPath ?? "").trim();

  if (!trimmedName) throw new Error("项目名不能为空");
  if (!trimmedPath) throw new Error("项目路径不能为空");

  const projects = config.projects.filter((p) => p?.name && p?.path);
  const existingIndex = projects.findIndex((p) => p.name === trimmedName);
  const next = { name: trimmedName, path: trimmedPath };
  if (existingIndex >= 0) projects[existingIndex] = next;
  else projects.push(next);

  saveConfig({ ...config, projects });
  return next;
}

export function removeProjectByName(name: unknown): number {
  const config = loadConfig();
  const trimmedName = String(name ?? "").trim();
  const projects = config.projects.filter((p) => p?.name && p?.path);
  const next = projects.filter((p) => p.name !== trimmedName);
  saveConfig({ ...config, projects: next });
  return projects.length - next.length;
}

export function validateRepoPath(repoPath: unknown): { ok: true } | { ok: false; reason: string } {
  const p = String(repoPath ?? "").trim();
  if (!p) return { ok: false, reason: "路径为空" };
  if (!fs.existsSync(p)) return { ok: false, reason: "路径不存在" };
  const gitDir = path.join(p, ".git");
  if (!fs.existsSync(gitDir)) return { ok: false, reason: "不是 git 仓库（缺少 .git）" };
  return { ok: true };
}

export function setGitAuthorFilter(authorPattern: unknown): string {
  const config = loadConfig();
  const author = String(authorPattern ?? "").trim();
  if (!author) throw new Error("author 不能为空");
  saveConfig({ ...config, git: { ...(config.git ?? {}), author } });
  return author;
}

export function clearGitAuthorFilter(): void {
  const config = loadConfig();
  saveConfig({ ...config, git: { ...(config.git ?? {}), author: "" } });
}

export function setGitNoiseFilter(enabled: unknown): boolean {
  const config = loadConfig();
  const on =
    enabled === true ||
    String(enabled ?? "")
      .trim()
      .toLowerCase() === "true" ||
    String(enabled ?? "")
      .trim()
      .toLowerCase() === "1";
  saveConfig({ ...config, git: { ...(config.git ?? {}), filterNoise: on } });
  return on;
}

export function updateGitConfig(patch: unknown): GitConfig {
  const config = loadConfig();
  const next = normalizeConfig({ ...config, git: { ...(config.git ?? {}), ...(isPlainObject(patch) ? patch : {}) } });
  saveConfig(next);
  return next.git;
}

export function setAiConfig(input: { apiKey: unknown; baseUrl: unknown; model: unknown }): { apiKey: string; baseUrl: string; model: string } {
  const config = loadConfig();
  const next = {
    apiKey: String(input.apiKey ?? "").trim(),
    baseUrl: String(input.baseUrl ?? "").trim(),
    model: String(input.model ?? "").trim(),
  };
  if (!next.apiKey) throw new Error("apiKey 不能为空");
  if (!next.baseUrl) throw new Error("baseUrl 不能为空");
  if (!next.model) throw new Error("model 不能为空");
  saveConfig({ ...config, ai: mergeAiConfig(config.ai, next) });
  return next;
}

export function clearAiConfig(): void {
  const config = loadConfig();
  saveConfig({ ...config, ai: mergeAiConfig(config.ai, { auth: { apiKey: "" } }) });
}

export function updateAiConfig(patch: unknown): AiConfig {
  const config = loadConfig();
  const next = normalizeConfig({ ...config, ai: mergeAiConfig(config.ai, patch) });
  saveConfig(next);
  return next.ai;
}

export function updateReportConfig(patch: unknown): ReportConfig {
  const config = loadConfig();
  const next = normalizeConfig({ ...config, report: { ...config.report, ...(isPlainObject(patch) ? patch : {}) } });
  saveConfig(next);
  return next.report;
}

export function updateProjectsScanConfig(patch: unknown): ProjectsScanConfig {
  const config = loadConfig();
  const next = normalizeConfig({ ...config, projectsScan: { ...config.projectsScan, ...(isPlainObject(patch) ? patch : {}) } });
  saveConfig(next);
  return next.projectsScan;
}
