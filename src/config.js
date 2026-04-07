import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CONFIG_DIR_NAME = ".commit-log-daily";
const CONFIG_FILE_NAME = "config.json";

export function getConfigFilePath() {
  return path.join(os.homedir(), CONFIG_DIR_NAME, CONFIG_FILE_NAME);
}

const DEFAULT_CONFIG = {
  version: 1,
  projects: [],
  git: { author: "" },
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
  },
};

function isPlainObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v));
}

function mergeAiConfig(current, patch) {
  const c = isPlainObject(current) ? current : {};
  const p = isPlainObject(patch) ? patch : {};

  const auth = isPlainObject(c.auth) ? c.auth : {};
  const endpoint = isPlainObject(c.endpoint) ? c.endpoint : {};
  const prompt = isPlainObject(c.prompt) ? c.prompt : {};
  const skills = isPlainObject(c.skills) ? c.skills : {};

  const next = {
    ...c,
    ...(Object.keys(p).some((k) => !["auth", "endpoint", "prompt", "skills"].includes(k)) ? p : {}),
    auth: { ...auth, ...(isPlainObject(p.auth) ? p.auth : {}) },
    endpoint: { ...endpoint, ...(isPlainObject(p.endpoint) ? p.endpoint : {}) },
    prompt: { ...prompt, ...(isPlainObject(p.prompt) ? p.prompt : {}) },
    skills: { ...skills, ...(isPlainObject(p.skills) ? p.skills : {}) },
  };

  if (Object.prototype.hasOwnProperty.call(p, "apiKey")) next.auth.apiKey = p.apiKey;
  if (Object.prototype.hasOwnProperty.call(p, "baseUrl")) next.endpoint.baseUrl = p.baseUrl;
  if (Object.prototype.hasOwnProperty.call(p, "model")) next.endpoint.model = p.model;
  if (Object.prototype.hasOwnProperty.call(p, "timeoutMs")) next.endpoint.timeoutMs = p.timeoutMs;
  if (Object.prototype.hasOwnProperty.call(p, "stream")) next.endpoint.stream = p.stream;
  if (Object.prototype.hasOwnProperty.call(p, "promptId")) next.prompt.id = p.promptId;
  if (Object.prototype.hasOwnProperty.call(p, "promptPath")) next.prompt.path = p.promptPath;
  if (Object.prototype.hasOwnProperty.call(p, "skillsPath")) next.skills.path = p.skillsPath;

  return next;
}

function normalizeConfig(input) {
  const parsed = typeof input === "object" && input ? input : {};
  const projects = Array.isArray(parsed.projects) ? parsed.projects : [];
  const normalizedProjects = projects
    .filter((p) => p && typeof p === "object")
    .map((p) => ({ name: String(p.name ?? "").trim(), path: String(p.path ?? "").trim() }))
    .filter((p) => p.name && p.path);

  const git = typeof parsed.git === "object" && parsed.git ? parsed.git : {};
  const author = String(git.author ?? "").trim();

  const ai = typeof parsed.ai === "object" && parsed.ai ? parsed.ai : {};
  const auth = isPlainObject(ai.auth) ? ai.auth : {};
  const endpoint = isPlainObject(ai.endpoint) ? ai.endpoint : {};
  const prompt = isPlainObject(ai.prompt) ? ai.prompt : {};
  const skills = isPlainObject(ai.skills) ? ai.skills : {};

  const apiKey = String(ai.apiKey ?? auth.apiKey ?? "").trim();
  const baseUrl =
    String(ai.baseUrl ?? endpoint.baseUrl ?? DEFAULT_CONFIG.ai.endpoint.baseUrl).trim() || DEFAULT_CONFIG.ai.endpoint.baseUrl;
  const model = String(ai.model ?? endpoint.model ?? DEFAULT_CONFIG.ai.endpoint.model).trim() || DEFAULT_CONFIG.ai.endpoint.model;

  const timeoutMsRaw = Number(ai.timeoutMs ?? endpoint.timeoutMs ?? DEFAULT_CONFIG.ai.endpoint.timeoutMs);
  const timeoutMs =
    Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? Math.floor(timeoutMsRaw) : DEFAULT_CONFIG.ai.endpoint.timeoutMs;

  const streamRaw = Object.prototype.hasOwnProperty.call(ai, "stream") ? ai.stream : endpoint.stream;
  const stream =
    streamRaw === true ||
    String(streamRaw ?? "")
      .trim()
      .toLowerCase() === "true" ||
    String(streamRaw ?? "")
      .trim()
      .toLowerCase() === "1";

  const promptId = String(ai.promptId ?? prompt.id ?? DEFAULT_CONFIG.ai.prompt.id).trim() || DEFAULT_CONFIG.ai.prompt.id;
  const promptPath = String(ai.promptPath ?? prompt.path ?? "").trim();
  const skillsPath = String(ai.skillsPath ?? skills.path ?? "").trim();

  const report = typeof parsed.report === "object" && parsed.report ? parsed.report : {};
  const outputDir = String(report.outputDir ?? "").trim();

  return {
    ...DEFAULT_CONFIG,
    version: Number(parsed.version ?? DEFAULT_CONFIG.version) || DEFAULT_CONFIG.version,
    projects: normalizedProjects,
    git: { author },
    ai: {
      auth: { apiKey },
      endpoint: { baseUrl, model, timeoutMs, stream },
      prompt: { id: promptId, path: promptPath },
      skills: { path: skillsPath },
    },
    report: { outputDir },
  };
}

function ensureConfigDirExists() {
  const configFilePath = getConfigFilePath();
  const dir = path.dirname(configFilePath);
  fs.mkdirSync(dir, { recursive: true });
}

export function loadConfig() {
  const configFilePath = getConfigFilePath();
  try {
    const raw = fs.readFileSync(configFilePath, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeConfig(parsed);
  } catch {
    return normalizeConfig(null);
  }
}

export function saveConfig(config) {
  ensureConfigDirExists();
  const configFilePath = getConfigFilePath();
  const normalized = normalizeConfig(config);
  fs.writeFileSync(configFilePath, JSON.stringify(normalized, null, 2), "utf8");
}

export function upsertProject({ name, repoPath }) {
  const config = loadConfig();
  const trimmedName = String(name ?? "").trim();
  const trimmedPath = String(repoPath ?? "").trim();

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

export function removeProjectByName(name) {
  const config = loadConfig();
  const trimmedName = String(name ?? "").trim();
  const projects = config.projects.filter((p) => p?.name && p?.path);
  const next = projects.filter((p) => p.name !== trimmedName);
  saveConfig({ ...config, projects: next });
  return projects.length - next.length;
}

export function validateRepoPath(repoPath) {
  const p = String(repoPath ?? "").trim();
  if (!p) return { ok: false, reason: "路径为空" };
  if (!fs.existsSync(p)) return { ok: false, reason: "路径不存在" };
  const gitDir = path.join(p, ".git");
  if (!fs.existsSync(gitDir)) return { ok: false, reason: "不是 git 仓库（缺少 .git）" };
  return { ok: true };
}

export function setGitAuthorFilter(authorPattern) {
  const config = loadConfig();
  const author = String(authorPattern ?? "").trim();
  if (!author) throw new Error("author 不能为空");
  saveConfig({ ...config, git: { ...(config.git ?? {}), author } });
  return author;
}

export function clearGitAuthorFilter() {
  const config = loadConfig();
  saveConfig({ ...config, git: { ...(config.git ?? {}), author: "" } });
}

export function setAiConfig({ apiKey, baseUrl, model }) {
  const config = loadConfig();
  const next = {
    apiKey: String(apiKey ?? "").trim(),
    baseUrl: String(baseUrl ?? "").trim(),
    model: String(model ?? "").trim(),
  };
  if (!next.apiKey) throw new Error("apiKey 不能为空");
  if (!next.baseUrl) throw new Error("baseUrl 不能为空");
  if (!next.model) throw new Error("model 不能为空");
  saveConfig({ ...config, ai: mergeAiConfig(config.ai, next) });
  return next;
}

export function clearAiConfig() {
  const config = loadConfig();
  saveConfig({ ...config, ai: mergeAiConfig(config.ai, { auth: { apiKey: "" } }) });
}

export function updateAiConfig(patch) {
  const config = loadConfig();
  const next = normalizeConfig({ ...config, ai: mergeAiConfig(config.ai, patch) });
  saveConfig(next);
  return next.ai;
}

export function updateReportConfig(patch) {
  const config = loadConfig();
  const next = normalizeConfig({ ...config, report: { ...config.report, ...(patch ?? {}) } });
  saveConfig(next);
  return next.report;
}
