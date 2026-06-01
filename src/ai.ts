import { buildSummaryMessages } from "./ai/prompt.js";

type ProjectCommit = { subject: string; author: string; date: string; hash: string };
type ProjectWithCommits = { name: string; path?: string; commits: ProjectCommit[] };

function parseBool(raw: unknown): boolean {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function getTimeoutMs(configAi: unknown): number {
  const raw = String(process.env.AI_TIMEOUT_MS ?? "").trim();
  if (raw) {
    const ms = Number(raw);
    if (Number.isFinite(ms) && ms > 0) return Math.floor(ms);
  }
  const cfg = Number((configAi as Record<string, unknown> | null | undefined)?.endpoint
    ? (configAi as Record<string, any>).endpoint?.timeoutMs
    : (configAi as Record<string, any> | null | undefined)?.timeoutMs ?? 0);
  if (Number.isFinite(cfg) && cfg > 0) return Math.floor(cfg);
  return 20000;
}

function safeOrigin(rawUrl: unknown): string {
  try {
    return new URL(String(rawUrl ?? "")).origin;
  } catch {
    return String(rawUrl ?? "");
  }
}

function describeFetchError(err: unknown): string {
  const e = (err ?? {}) as Record<string, unknown>;
  const name = String(e.name ?? "").trim();
  const message = String(e.message ?? "").trim();
  const cause = (e as any).cause ?? null;
  const causeCode = String(cause?.code ?? "").trim();
  const causeMessage = String(cause?.message ?? "").trim();

  const parts: string[] = [];
  if (name) parts.push(name);
  if (message) parts.push(message);
  if (causeCode) parts.push(`code=${causeCode}`);
  if (causeMessage) parts.push(`cause=${causeMessage}`);
  return parts.filter(Boolean).join(" | ") || "fetch failed";
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeBaseUrl(raw: unknown): string {
  const base = String(raw ?? "").trim();
  if (!base) return "";
  if (base.endsWith("/")) return base.slice(0, -1);
  return base;
}

function buildOpenAIChatUrl(baseUrl: unknown): string {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return "";
  if (base.endsWith("/v1")) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

export function getAiEnv(): { apiKey: string; baseUrl: string; model: string } {
  const apiKey = String(process.env.AI_API_KEY ?? "").trim();
  const baseUrl = String(process.env.AI_BASE_URL ?? "").trim();
  const model = String(process.env.AI_MODEL ?? "").trim();
  return { apiKey, baseUrl, model };
}

export function resolveAiConfig(configAi: unknown): { apiKey: string; baseUrl: string; model: string } {
  const env = getAiEnv();
  const cfg = (configAi ?? {}) as Record<string, any>;
  const apiKey = env.apiKey || String(cfg?.auth?.apiKey ?? cfg?.apiKey ?? "").trim();
  const baseUrl = env.baseUrl || String(cfg?.endpoint?.baseUrl ?? cfg?.baseUrl ?? "https://api.openai.com").trim();
  const model = env.model || String(cfg?.endpoint?.model ?? cfg?.model ?? "gpt-4.1-mini").trim();
  return { apiKey, baseUrl, model };
}

export function isAiConfigured(configAi: unknown): boolean {
  const { apiKey, baseUrl } = resolveAiConfig(configAi);
  return Boolean(apiKey && baseUrl);
}

export function isAiStreamEnabled(configAi: unknown): boolean {
  if (String(process.env.AI_STREAM ?? "").trim()) return parseBool(process.env.AI_STREAM);
  const cfg = (configAi ?? {}) as Record<string, any>;
  return Boolean(cfg?.endpoint?.stream ?? cfg?.stream);
}

async function readStreamText(res: Response, onToken: ((token: string) => void) | null): Promise<string> {
  const reader = res.body?.getReader?.();
  if (!reader) throw new Error("响应不支持流式读取");

  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let output = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data) continue;
      if (data === "[DONE]") return output;
      let json: any;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      const delta = json?.choices?.[0]?.delta ?? {};
      const text = delta?.content ?? "";
      if (typeof text === "string" && text) {
        output += text;
        if (typeof onToken === "function") onToken(text);
      }
    }
  }

  return output;
}

export async function summarizeWithAi(input: {
  title: string;
  rangeLabel: string;
  authorPattern?: string;
  projects: ProjectWithCommits[];
  aiConfig?: unknown;
  features?: { requirementGrouping?: boolean } | null;
  stream?: boolean;
  onToken?: ((token: string) => void) | null;
}): Promise<string> {
  const { apiKey, baseUrl, model } = resolveAiConfig(input.aiConfig);
  if (!apiKey) throw new Error("未配置 AI_API_KEY（环境变量或配置）");

  const url = buildOpenAIChatUrl(baseUrl);
  if (!url) throw new Error("未配置 AI_BASE_URL（环境变量或配置）");
  if (typeof fetch !== "function") throw new Error("当前 Node 版本不支持 fetch，请升级到 Node 18+");
  const messages = buildSummaryMessages({
    title: input.title,
    rangeLabel: input.rangeLabel,
    authorPattern: input.authorPattern ?? "",
    projects: input.projects,
    aiConfig: input.aiConfig ?? null,
    features: input.features ?? null,
  });
  const timeoutMs = getTimeoutMs(input.aiConfig);

  const payload = {
    model,
    temperature: 0.2,
    messages,
    stream: Boolean(input.stream),
  };

  let res: Response;
  try {
    res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      },
      timeoutMs,
    );
  } catch (e) {
    const origin = safeOrigin(url);
    const details = describeFetchError(e);
    throw new Error(
      `AI 网络请求失败：${details}；origin=${origin}；timeoutMs=${timeoutMs}。请检查 AI_BASE_URL 可达性、代理/网络限制、HTTPS 证书。`,
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI 请求失败: ${res.status} ${text}`.trim());
  }

  if (input.stream) {
    const streamed = await readStreamText(res, input.onToken ?? null);
    const trimmed = String(streamed ?? "").trim();
    if (!trimmed) throw new Error("AI 返回为空");
    return trimmed;
  }

  const data: any = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI 返回为空");
  return String(content).trim();
}

export function summarizeLocally(input: {
  title: string;
  rangeLabel: string;
  authorPattern?: string;
  projects: ProjectWithCommits[];
}): string {
  const lines: string[] = [];
  lines.push(`# ${input.title}`);
  lines.push("");
  lines.push(`范围：${input.rangeLabel}`);
  if (String(input.authorPattern ?? "").trim()) lines.push(`提交人过滤：${String(input.authorPattern).trim()}`);
  lines.push("");

  const totalCommits = input.projects.reduce((acc, p) => acc + (p.commits?.length ?? 0), 0);
  lines.push(`总提交数：${totalCommits}`);
  lines.push("");

  for (const p of input.projects) {
    lines.push(`## ${p.name}`);
    if (!p.commits?.length) {
      lines.push("- （无提交）");
      lines.push("");
      continue;
    }
    const byAuthor = new Map<string, number>();
    for (const c of p.commits) {
      const key = c.author || "unknown";
      byAuthor.set(key, (byAuthor.get(key) ?? 0) + 1);
    }
    const authorSummary = Array.from(byAuthor.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([author, count]) => `${author} ${count}`)
      .join("，");
    if (authorSummary) lines.push(`- 作者分布：${authorSummary}`);
    for (const c of p.commits) {
      lines.push(`- ${c.subject} (${c.author}, ${String(c.date).slice(0, 10)}, ${c.hash.slice(0, 7)})`);
    }
    lines.push("");
  }

  lines.push("## 风险/阻塞");
  lines.push("- 暂无明显风险（本地模式无法进行语义判断）");
  lines.push("");
  lines.push("## 下一步");
  lines.push("- 如果需要更高质量总结，请配置 AI_API_KEY / AI_BASE_URL / AI_MODEL");
  lines.push("");

  return lines.join("\n");
}
