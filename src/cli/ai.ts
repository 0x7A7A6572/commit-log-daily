import { clearAiConfig, loadConfig, updateAiConfig } from "../config.js";
import { maskSecret, formatKeyValueTable } from "../utils/cli.js";
import { listPromptChoices } from "../ai/prompt.js";

function buildPromptSourceChoices(): Array<{ name: string; value: { kind: "builtin"; id: string } | { kind: "file" } }> {
  const builtin = listPromptChoices().map((p) => ({ name: `内置：${p.name} (${p.id})`, value: { kind: "builtin", id: p.id } as const }));
  return [...builtin, { name: "自定义：从文件加载", value: { kind: "file" } as const }];
}

export async function manageAiInteractive(inquirer: any): Promise<void> {
  for (;;) {
    const config = loadConfig();
    const current = config?.ai ?? {};
    const currentKeyMasked = current?.auth?.apiKey ? maskSecret(current.auth.apiKey) : "无";
    const currentBaseUrl = current?.endpoint?.baseUrl || "无";
    const currentModel = current?.endpoint?.model || "无";
    const currentTimeout = current?.endpoint?.timeoutMs ? `${current.endpoint.timeoutMs}ms` : "无";
    const currentStream = current?.endpoint?.stream ? "开" : "关";
    const currentPrompt = current?.prompt?.path ? `file:${current.prompt.path}` : `builtin:${current?.prompt?.id || "default"}`;
    const currentSkills = current?.skills?.path || "无";
    const table = formatKeyValueTable([
      { k: "API Key", v: currentKeyMasked },
      { k: "Base URL", v: currentBaseUrl },
      { k: "Model", v: currentModel },
      { k: "Timeout", v: currentTimeout },
      { k: "Stream", v: currentStream },
      { k: "Prompt", v: currentPrompt },
      { k: "Skills", v: currentSkills },
    ]);

    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: `AI 配置\n\n${table}`,
        choices: [
          { name: "配置 Key / Endpoint", value: "endpoint" },
          { name: "配置 Prompt", value: "prompt" },
          { name: "配置 Skills", value: "skills" },
          { name: "清空 API Key", value: "clearKey" },
          { name: "返回", value: "back" },
        ],
      },
    ]);

    if (action === "back") return;
    if (action === "clearKey") {
      clearAiConfig();
      console.log("已清空 API Key。");
      continue;
    }
    if (action === "endpoint") {
      await configureEndpoint(inquirer);
      continue;
    }
    if (action === "prompt") {
      await configurePrompt(inquirer);
      continue;
    }
    if (action === "skills") {
      await configureSkills(inquirer);
      continue;
    }
  }
}

async function configureEndpoint(inquirer: any): Promise<void> {
  const config = loadConfig();
  const current = config?.ai ?? {};
  const currentKey = String(current?.auth?.apiKey ?? "").trim();
  const hasExistingKey = Boolean(currentKey);

  let nextApiKey = currentKey;
  if (!hasExistingKey) {
    const { apiKey } = await inquirer.prompt([
      { type: "password", name: "apiKey", message: "AI_API_KEY", mask: "*", validate: (v: unknown) => (String(v).trim() ? true : "必填") },
    ]);
    nextApiKey = String(apiKey).trim();
  } else {
    const { updateKey } = await inquirer.prompt([
      { type: "confirm", name: "updateKey", message: `已存在 apiKey（${maskSecret(currentKey)}），需要更新吗？`, default: false },
    ]);
    if (updateKey) {
      const { apiKey } = await inquirer.prompt([
        { type: "password", name: "apiKey", message: "AI_API_KEY（更新）", mask: "*", validate: (v: unknown) => (String(v).trim() ? true : "必填") },
      ]);
      nextApiKey = String(apiKey).trim();
    }
  }

  const defaults = {
    baseUrl: current?.endpoint?.baseUrl || "https://api.openai.com",
    model: current?.endpoint?.model || "gpt-4.1-mini",
    timeoutMs:
      Number.isFinite(Number(current?.endpoint?.timeoutMs)) && Number(current?.endpoint?.timeoutMs) > 0 ? String(Number(current.endpoint.timeoutMs)) : "20000",
    stream: Boolean(current?.endpoint?.stream),
  };

  const answers = await inquirer.prompt([
    { type: "input", name: "baseUrl", message: "AI_BASE_URL", default: defaults.baseUrl, validate: (v: unknown) => (String(v).trim() ? true : "必填") },
    { type: "input", name: "model", message: "AI_MODEL", default: defaults.model, validate: (v: unknown) => (String(v).trim() ? true : "必填") },
    { type: "input", name: "timeoutMs", message: "AI_TIMEOUT_MS（毫秒）", default: defaults.timeoutMs, validate: (v: unknown) => (Number(String(v).trim()) > 0 ? true : "必须是正数") },
    { type: "confirm", name: "stream", message: "启用流式输出到控制台（stream）？", default: defaults.stream },
  ]);

  updateAiConfig({
    auth: { apiKey: nextApiKey },
    endpoint: {
      baseUrl: String(answers.baseUrl).trim(),
      model: String(answers.model).trim(),
      timeoutMs: Math.floor(Number(String(answers.timeoutMs).trim())),
      stream: Boolean(answers.stream),
    },
  });

  console.log("已保存。");
  console.log("提示：apiKey 会以明文存储在本机配置文件中。");
}

async function configurePrompt(inquirer: any): Promise<void> {
  const config = loadConfig();
  const current = config?.ai ?? {};
  const answers = await inquirer.prompt([{ type: "list", name: "promptSource", message: "Prompt 选择", choices: buildPromptSourceChoices() }]);

  let promptId = current?.prompt?.id || "default";
  let promptPath = current?.prompt?.path || "";

  if (answers.promptSource.kind === "builtin") {
    promptId = answers.promptSource.id;
    promptPath = "";
  } else {
    const r = await inquirer.prompt([
      { type: "input", name: "promptPath", message: "自定义 Prompt 文件路径（txt/md 均可）", default: promptPath, validate: (v: unknown) => (String(v).trim() ? true : "必填") },
    ]);
    promptId = "default";
    promptPath = String(r.promptPath).trim();
  }

  updateAiConfig({ prompt: { id: promptId, path: promptPath } });
  console.log("已保存。");
}

async function configureSkills(inquirer: any): Promise<void> {
  const config = loadConfig();
  const current = config?.ai ?? {};
  const currentPath = String(current?.skills?.path ?? "").trim();
  const r = await inquirer.prompt([{ type: "input", name: "skillsPath", message: "Skills 文件路径（可选，留空=不注入）", default: currentPath }]);
  updateAiConfig({ skills: { path: String(r.skillsPath ?? "").trim() } });
  console.log("已保存。");
}

export async function setupAiOnce(inquirer: any): Promise<void> {
  await configureEndpoint(inquirer);
  const { more } = await inquirer.prompt([{ type: "confirm", name: "more", message: "继续配置 Prompt / Skills？", default: true }]);
  if (!more) return;
  await configurePrompt(inquirer);
  await configureSkills(inquirer);
}
