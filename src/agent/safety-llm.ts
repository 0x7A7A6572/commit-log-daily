import { ChatOpenAI } from "@langchain/openai";

import type { ContentBlock, } from "@langchain/core/messages";
import { SafetyLevel } from "./types.js";
import type { SafetyLevel as SafetyLevelType } from "./types.js";
import { readConfig } from "../config/store.js";
import { normalizeBaseUrl } from "../shared/utils.js";

/**
 * 创建安全评估专用的 ChatOpenAI 实例
 * 每次调用重新读取配置，确保对话中通过 /config 修改 API Key 即时生效
 */
function getSafetyLLM(): ChatOpenAI {
  const config = readConfig();
  const baseUrl = normalizeBaseUrl(config.model.baseUrl);

  return new ChatOpenAI({
    model: config.model.model,
    temperature: 0,
    configuration: {
      baseURL: baseUrl,
      apiKey: config.model.apiKey,
    },
  });
}

function parseJSON(rawText: string | (ContentBlock)[]): any {
  // 1. 处理数组类型：提取其中的纯文本部分
  let textToParse = "";
  if (typeof rawText === "string") {
    textToParse = rawText;
  } else if (Array.isArray(rawText)) {
    // 过滤出类型为 'text' 的块，并拼接内容
    textToParse = rawText
      .map((block) => block.text)
      .join("\n");
  }

  if (!textToParse.trim()) {
    throw new Error("LLM 返回的内容中没有可提取的文本");
  }

  try {
    // 2. 尝试直接解析
    return JSON.parse(textToParse);
  } catch (e) {
    // 3. 如果失败，尝试提取 Markdown 代码块中的 JSON
    const jsonMatch = textToParse.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch && jsonMatch[1]) {
      return JSON.parse(jsonMatch[1].trim());
    }
    // 4. 终极兜底
    throw new Error(`无法解析 LLM 返回的 JSON。原始内容: ${textToParse}`);
  }
}

/** 安全评估：先本地正则后 LLM 二次确认 */
export async function evaluateSafety(command: string, args: string[]): Promise<SafetyLevel> {
  const fullCommand = `${command} ${args.join(' ')}`;

  // 调用独立的 LLM 进行评估
  const safetyLLM = getSafetyLLM();
  const response = await safetyLLM.invoke([
    {
      role: "system",
      content: `你是一个安全评估专家。判断以下命令的风险等级,是否需要用户确认。
      ${SafetyLevel.Blocked}(Blocked) : 风险极高，禁止执行
      ${SafetyLevel.Warn}(Warn)    : 风险较高，需要用户确认
      ${SafetyLevel.Safe}(Safe)    : 风险较低，可以执行
      评估标准:
      风险极高: 如 rm -rf /（删除根目录） | sudo | mkfs | dd if= | shutdown | reboot 等会导致系统崩溃的命令
      风险较高: 如 rm | mv | cp | chmod | chown | > | 执行外部脚本 等有副作用的命令
      风险较低: 如 ls | cat | grep | awk | sed | awk | curl | wget 等无副作用的命令
      仅返回 JSON: {"level": "Safe" | "Warn" | "Blocked"`
    },
    {
      role: "user",
      content: fullCommand
    }
  ]);

  // 解析 LLM 返回的字符串等级，映射为 SafetyLevel 枚举
  const raw = parseJSON(response.content).level;
  const map: Record<string, SafetyLevelType> = {
    // 提示词中指定的标准标签（从枚举反向映射，保证一致）
    [SafetyLevel[SafetyLevel.Safe]]: SafetyLevel.Safe,
    [SafetyLevel[SafetyLevel.Warn]]: SafetyLevel.Warn,
    [SafetyLevel[SafetyLevel.Blocked]]: SafetyLevel.Blocked,
  };
  if (!(raw in map)) {
    // LLM 返回了未知等级 → 兜底为 Warn，宁可多确认也不漏
    return SafetyLevel.Warn;
  }
  return map[raw];
}

/**
 * 本地评估
 * @param command 
 * @param args 
 */
export function evaluateSafetyOfLocal(command: string, args: string[]): SafetyLevelType {
  // 黑名单拦截
  const full = [command, ...args].join(' ')

  // 无论如何不允许：删除根目录等真正致命的操作，其他 rm -rf 降级到 Warn 走用户确认
  if (/rm\s+-rf\s+(\/|[A-Za-z]:\\(?:\*)?(?:\s|$))|sudo|mkfs|dd\s+if=|shutdown|reboot/.test(full)) {
    return SafetyLevel.Blocked
  }

  // 可能有副作用，需要用户确认
  if (/rm\b|mv\b|cp\b.*\/dev|chmod|chown|>/.test(full)) {
    return SafetyLevel.Warn
  }
  // 管道+网络下载 组合检测
  if ((command === 'curl' || command === 'wget') && full.includes('|')) {
    return SafetyLevel.Warn
  }

  // safe: 其余全部放行
  return SafetyLevel.Safe
}

/** 安全通道校验：先本地后 LLM，本地已有结论时跳过 LLM 节省 token */
export async function safetyChannelCheck(command: string, args: string[], hooks: Record<SafetyLevelType, () => Promise<void>>): Promise<void> {
  const localLevel = evaluateSafetyOfLocal(command, args);

  // 本地已判定非 Safe → 直接采用，不调 LLM（节省 token + 避免 LLM 误判降级）
  if (localLevel !== SafetyLevel.Safe) {
    return hooks[localLevel]();
  }

  // 本地判定 Safe → LLM 做二次确认，取两者最高等级
  const llmLevel = await evaluateSafety(command, args);
  const level = Math.max(llmLevel, localLevel) as SafetyLevelType;

  return hooks[level]();
}