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

export type GroupingSource = "subject" | "branches";
export type GroupingExtractor =
  | { kind: "regex"; source: GroupingSource; pattern: string; flags?: string; group?: number; keyPrefix?: string }
  | { kind: "builtin"; id: "legacyRequirement" };

export type GroupingRule = {
  id: string;
  name: string;
  enabled: boolean;
  displayStyle: "plain" | "requirementKey";
  extractors: GroupingExtractor[];
  unknownKey: string;
};

export type GroupingConfig = {
  enabled: boolean;
  branchesContainsEnabled: boolean;
  defaultRuleId: string;
  rules: GroupingRule[];
};

export type FeatureConfig = {
  requirementGrouping: boolean;
  grouping: GroupingConfig;
};

export type AppConfig = {
  version: number;
  projects: Project[];
  git: GitConfig;
  projectsScan: ProjectsScanConfig;
  ai: AiConfig;
  report: ReportConfig;
  features: FeatureConfig;
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
  features: {
    requirementGrouping: false,
    grouping: {
      enabled: true,
      branchesContainsEnabled: false,
      defaultRuleId: "",
      rules: [
        {
          id: "legacy-requirement",
          name: "Legacy: 按需求/任务分组（分支/提交推断）",
          enabled: false,
          displayStyle: "requirementKey",
          extractors: [{ kind: "builtin", id: "legacyRequirement" }],
          unknownKey: "unknown",
        },
      ],
    },
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

function parseBooleanLike(raw: unknown, fallback: boolean): boolean {
  if (raw === true) return true;
  if (raw === false) return false;
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!v) return fallback;
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return fallback;
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
  const filterNoise = parseBooleanLike(filterNoiseRaw, false);

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
  const stream = parseBooleanLike(streamRaw, Boolean(DEFAULT_CONFIG.ai.endpoint.stream));

  const promptId = String(ai.promptId ?? promptObj.id ?? DEFAULT_CONFIG.ai.prompt.id).trim() || DEFAULT_CONFIG.ai.prompt.id;
  const promptPath = String(ai.promptPath ?? promptObj.path ?? "").trim();
  const skillsPath = String(ai.skillsPath ?? skillsObj.path ?? "").trim();

  const reportObj = isPlainObject(parsed.report) ? parsed.report : {};
  const outputDir = String(reportObj.outputDir ?? "").trim();
  const outputModeRaw = String(reportObj.outputMode ?? DEFAULT_CONFIG.report.outputMode).trim();
  const outputMode: ReportOutputMode = (["stdout", "file", "both"] as const).includes(outputModeRaw as ReportOutputMode)
    ? (outputModeRaw as ReportOutputMode)
    : DEFAULT_CONFIG.report.outputMode;

  const featuresObj = isPlainObject(parsed.features) ? parsed.features : {};
  const requirementGroupingRaw = Object.prototype.hasOwnProperty.call(featuresObj, "requirementGrouping")
    ? featuresObj.requirementGrouping
    : false;
  const requirementGrouping = parseBooleanLike(requirementGroupingRaw, Boolean(DEFAULT_CONFIG.features.requirementGrouping));

  const groupingObj = isPlainObject(featuresObj.grouping) ? featuresObj.grouping : {};
  const groupingEnabled = parseBooleanLike(
    Object.prototype.hasOwnProperty.call(groupingObj, "enabled") ? groupingObj.enabled : undefined,
    true,
  );
  const branchesContainsEnabledSpecified = Object.prototype.hasOwnProperty.call(groupingObj, "branchesContainsEnabled");
  const branchesContainsEnabledRaw = branchesContainsEnabledSpecified ? (groupingObj as any).branchesContainsEnabled : undefined;
  const defaultRuleId = String(groupingObj.defaultRuleId ?? DEFAULT_CONFIG.features.grouping.defaultRuleId).trim() || DEFAULT_CONFIG.features.grouping.defaultRuleId;
  const rulesRaw = Array.isArray(groupingObj.rules) ? groupingObj.rules : [];
  const normalizedRules: GroupingRule[] = rulesRaw
    .filter((r): r is Record<string, unknown> => isPlainObject(r))
    .map((r) => {
      const id = String(r.id ?? "").trim();
      const name = String(r.name ?? "").trim() || id;
      const enabled = parseBooleanLike(Object.prototype.hasOwnProperty.call(r, "enabled") ? r.enabled : true, true);
      const displayStyleRaw = String(r.displayStyle ?? "plain").trim();
      const displayStyle: GroupingRule["displayStyle"] = (["plain", "requirementKey"] as const).includes(displayStyleRaw as any)
        ? (displayStyleRaw as GroupingRule["displayStyle"])
        : "plain";
      const unknownKey = String(r.unknownKey ?? "unknown").trim() || "unknown";
      const extractorsRaw = Array.isArray(r.extractors) ? r.extractors : [];
      const extractors = extractorsRaw
        .filter((e): e is Record<string, unknown> => isPlainObject(e))
        .map((e) => {
          const kind = String(e.kind ?? "").trim();
          if (kind === "builtin") {
            const bid = String(e.id ?? "").trim();
            if (bid === "legacyRequirement") return { kind: "builtin", id: "legacyRequirement" } as GroupingExtractor;
            return null;
          }
          if (kind === "regex") {
            const sourceRaw = String(e.source ?? "").trim();
            const source: GroupingSource = sourceRaw === "branches" ? "branches" : "subject";
            const pattern = String(e.pattern ?? "").trim();
            if (!pattern) return null;
            const groupRaw = Number(e.group ?? 1);
            const group = Number.isFinite(groupRaw) && groupRaw >= 0 ? Math.floor(groupRaw) : 1;
            const flags = String(e.flags ?? "").trim();
            const keyPrefix = String(e.keyPrefix ?? "").trim();
            const out: GroupingExtractor = {
              kind: "regex",
              source,
              pattern,
              ...(flags ? { flags } : {}),
              ...(Number.isFinite(group) ? { group } : {}),
              ...(keyPrefix ? { keyPrefix } : {}),
            };
            return out;
          }
          return null;
        })
        .filter((x): x is GroupingExtractor => x != null);
      if (!id) return null;
      return { id, name, enabled, displayStyle, extractors, unknownKey };
    })
    .filter((x): x is GroupingRule => Boolean(x))
    .filter((r) => r.id && r.extractors.length);
  const rules = normalizedRules.length ? normalizedRules : DEFAULT_CONFIG.features.grouping.rules;
  const branchesContainsEnabled =
    branchesContainsEnabledSpecified
      ? parseBooleanLike(branchesContainsEnabledRaw, Boolean(DEFAULT_CONFIG.features.grouping.branchesContainsEnabled))
      : rules.some((r) => r.enabled && r.extractors.some((e) => e.kind === "builtin" || (e.kind === "regex" && e.source === "branches")));

  const normalizedRequirementGrouping = requirementGrouping;

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
    features: { requirementGrouping: normalizedRequirementGrouping, grouping: { enabled: groupingEnabled, branchesContainsEnabled, defaultRuleId, rules } },
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

export function updateFeaturesConfig(patch: unknown): FeatureConfig {
  const config = loadConfig();
  const p = isPlainObject(patch) ? patch : {};
  const current = isPlainObject(config.features) ? config.features : {};
  const currentGrouping = isPlainObject((current as any).grouping) ? (current as any).grouping : {};
  const patchGrouping = isPlainObject((p as any).grouping) ? (p as any).grouping : null;
  const mergedGrouping = patchGrouping
    ? {
        ...currentGrouping,
        ...patchGrouping,
        rules: Array.isArray(patchGrouping.rules) ? patchGrouping.rules : currentGrouping.rules,
      }
    : currentGrouping;
  const mergedFeatures = patchGrouping ? { ...current, ...p, grouping: mergedGrouping } : { ...current, ...p };
  const next = normalizeConfig({ ...config, features: mergedFeatures });
  saveConfig(next);
  return next.features;
}
