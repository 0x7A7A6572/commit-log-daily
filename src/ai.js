import { buildSummaryMessages } from "./ai/prompt.js";

function parseBool(raw) {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function getTimeoutMs(configAi) {
  const raw = String(process.env.AI_TIMEOUT_MS ?? "").trim();
  if (raw) {
    const ms = Number(raw);
    if (Number.isFinite(ms) && ms > 0) return Math.floor(ms);
  }
  const cfg = Number(configAi?.endpoint?.timeoutMs ?? configAi?.timeoutMs ?? 0);
  if (Number.isFinite(cfg) && cfg > 0) return Math.floor(cfg);
  return 20000;
}

function safeOrigin(rawUrl) {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return String(rawUrl ?? "");
  }
}

function describeFetchError(err) {
  const e = err ?? {};
  const name = String(e.name ?? "").trim();
  const message = String(e.message ?? "").trim();
  const cause = e.cause ?? null;
  const causeCode = String(cause?.code ?? "").trim();
  const causeMessage = String(cause?.message ?? "").trim();

  const parts = [];
  if (name) parts.push(name);
  if (message) parts.push(message);
  if (causeCode) parts.push(`code=${causeCode}`);
  if (causeMessage) parts.push(`cause=${causeMessage}`);
  return parts.filter(Boolean).join(" | ") || "fetch failed";
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeBaseUrl(raw) {
  const base = String(raw ?? "").trim();
  if (!base) return "";
  if (base.endsWith("/")) return base.slice(0, -1);
  return base;
}

function buildOpenAIChatUrl(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return "";
  if (base.endsWith("/v1")) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

export function getAiEnv() {
  const apiKey = String(process.env.AI_API_KEY ?? "").trim();
  const baseUrl = String(process.env.AI_BASE_URL ?? "").trim();
  const model = String(process.env.AI_MODEL ?? "").trim();
  return { apiKey, baseUrl, model };
}

export function resolveAiConfig(configAi) {
  const env = getAiEnv();
  const apiKey = env.apiKey || String(configAi?.auth?.apiKey ?? configAi?.apiKey ?? "").trim();
  const baseUrl = env.baseUrl || String(configAi?.endpoint?.baseUrl ?? configAi?.baseUrl ?? "https://api.openai.com").trim();
  const model = env.model || String(configAi?.endpoint?.model ?? configAi?.model ?? "gpt-4.1-mini").trim();
  return { apiKey, baseUrl, model };
}

export function isAiConfigured(configAi) {
  const { apiKey, baseUrl } = resolveAiConfig(configAi);
  return Boolean(apiKey && baseUrl);
}

export function isAiStreamEnabled(configAi) {
  if (String(process.env.AI_STREAM ?? "").trim()) return parseBool(process.env.AI_STREAM);
  return Boolean(configAi?.endpoint?.stream ?? configAi?.stream);
}

async function readStreamText(res, onToken) {
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
      let json;
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

export async function summarizeWithAi({ title, rangeLabel, authorPattern = "", projects, aiConfig = null, stream = false, onToken = null }) {
  const { apiKey, baseUrl, model } = resolveAiConfig(aiConfig);
  if (!apiKey) throw new Error("未配置 AI_API_KEY（环境变量或配置）");

  const url = buildOpenAIChatUrl(baseUrl);
  if (!url) throw new Error("未配置 AI_BASE_URL（环境变量或配置）");
  if (typeof fetch !== "function") throw new Error("当前 Node 版本不支持 fetch，请升级到 Node 18+");
  const messages = buildSummaryMessages({ title, rangeLabel, authorPattern, projects, aiConfig });
  const timeoutMs = getTimeoutMs(aiConfig);

  const payload = {
    model,
    temperature: 0.2,
    messages,
    stream: Boolean(stream),
  };

  let res;
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

  if (stream) {
    const streamed = await readStreamText(res, onToken);
    const trimmed = String(streamed ?? "").trim();
    if (!trimmed) throw new Error("AI 返回为空");
    return trimmed;
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI 返回为空");
  return String(content).trim();
}

export function summarizeLocally({ title, rangeLabel, authorPattern = "", projects }) {
  const lines = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`范围：${rangeLabel}`);
  if (String(authorPattern ?? "").trim()) lines.push(`提交人过滤：${String(authorPattern).trim()}`);
  lines.push("");

  const totalCommits = projects.reduce((acc, p) => acc + (p.commits?.length ?? 0), 0);
  lines.push(`总提交数：${totalCommits}`);
  lines.push("");

  for (const p of projects) {
    lines.push(`## ${p.name}`);
    if (!p.commits?.length) {
      lines.push("- （无提交）");
      lines.push("");
      continue;
    }
    const byAuthor = new Map();
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
