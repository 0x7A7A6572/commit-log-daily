import { SystemMessage, AIMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { readConfig } from '../config/store.js';
import { generateUUID, normalizeBaseUrl } from '../shared/utils.js';
import type { SummaryMemory } from './types.js';

/**
 * 压缩结果：压缩后的消息列表 + 摘要元数据（用于持久化）
 */
export interface CondenseResult {
  messages: BaseMessage[];
  summary: SummaryMemory | null;
}

/**
 * 计算一条消息的 token 数
 */
async function countMsgTokens(msg: BaseMessage, model: ChatOpenAI): Promise<number> {
  const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
  return model.getNumTokens(text);
}

/**
 * 创建一个用于摘要的 ChatOpenAI 实例（不绑定工具和系统提示）
 */
function createSummaryModel(): ChatOpenAI {
  const config = readConfig();
  let baseUrl = normalizeBaseUrl(config.model.baseUrl);
  return new ChatOpenAI({
    model: config.model.model,
    temperature: 0,
    configuration: {
      baseURL: baseUrl,
      apiKey: config.model.apiKey,
    },
  });
}

/**
 * 压缩早期对话历史：用 LLM 生成的摘要替换最早的一批消息
 *
 * 触发条件：消息总 token 数超过 maxTokens 的 70%（留 30% headroom）
 * 跳过条件：消息不足 3 条、摘要比原文更占 token、或已标记为已压缩
 *
 * @param messages 对话消息（不含 SystemMessage）
 * @param maxTokens 上下文窗口上限
 * @param model 可选 — 用于 token 计数和摘要生成的模型实例，不传则自动创建
 * @param sessionId 可选 — 用于填充返回的 SummaryMemory.sessionId
 * @returns 压缩后的消息列表和摘要元数据
 */
export async function condenseMessages(
  messages: BaseMessage[],
  maxTokens?: number,
  model?: ChatOpenAI,
  sessionId?: string,
): Promise<CondenseResult> {
  // 消息太少，不值得压缩
  if (messages.length <= 3) return { messages, summary: null };

  const modelInstance = model ?? createSummaryModel();
  const config = readConfig();
  const tokenLimit = maxTokens ?? config.model.maxContextTokens;
  const budget = Math.floor(tokenLimit * 0.7);

  // 并行计算所有消息的 token 数（#5 优化）
  const tokenCounts = await Promise.all(
    messages.map((msg) => countMsgTokens(msg, modelInstance)),
  );
  let totalTokens = 0;
  for (const count of tokenCounts) {
    totalTokens += count;
  }
  if (totalTokens <= budget) return { messages, summary: null };

  // 从最早的消息开始累积，找到需要压缩的范围
  let condensedTokens = 0;
  let condenseEnd = 0;
  for (let i = 0; i < messages.length - 1; i++) {
    condensedTokens += tokenCounts[i]!;
    condenseEnd = i + 1;

    // 期望摘要 ~200 tokens，压缩后总 token ≤ budget 就收手
    const projected = totalTokens - condensedTokens + 200;
    if (projected <= budget) break;
    if (condenseEnd >= messages.length - 1) break;
  }

  const toCondense = messages.slice(0, condenseEnd);
  const condensedCount = toCondense.length;

  // 覆盖太短不值得压缩
  if (condensedCount < 3 && condensedTokens <= 512) return { messages, summary: null };

  // 构建对话文本供 LLM 摘要（截断到 200 字避免输入过长）
  const dialogText = toCondense
    .map((m, i) => {
      const roleMap: Record<string, string> = { human: '用户', ai: '助手', tool: '工具', system: '系统' };
      const role = roleMap[m.getType()] ?? m.getType();
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      const prefix = content.length > 200 ? content.slice(0, 200) + '…' : content;
      return `[${i + 1}] ${role}: ${prefix}`;
    })
    .join('\n\n');

  // 调 LLM 生成摘要
  const summaryPrompt = [
    new SystemMessage(
      '你是一个专业的对话摘要助手。请为以下对话生成一份简洁的摘要，保留以下信息：\n' +
      '· 用户的核心需求和目标\n' +
      '· 已经完成的工作和收集到的数据（概括性描述，不含原始数据）\n' +
      '· 项目配置和关键决策\n' +
      '· 用户表达的偏好和要求\n' +
      '摘要应简明扼要，控制在 150-300 字之间。',
    ),
    new HumanMessage(`请总结以下对话：\n\n${dialogText}`),
  ];

  // 调 LLM 生成摘要（失败时降级为不压缩，避免阻塞主流程）
  let summaryContent: string;
  let summaryTokens: number;
  try {
    const summaryResponse = await modelInstance.invoke(summaryPrompt);
    summaryContent =
      typeof summaryResponse.content === 'string'
        ? summaryResponse.content
        : JSON.stringify(summaryResponse.content);

    summaryTokens = await modelInstance.getNumTokens(summaryContent);
  } catch {
    // LLM 调用失败（网络错误/API 错误）→ 跳过摘要，直接发送原始消息
    return { messages, summary: null };
  }

  // 摘要反而更占 token → 跳过
  if (summaryTokens >= condensedTokens) return { messages, summary: null };

  // 替换压缩范围为一条摘要消息
  const summaryMsg = new AIMessage({
    content: `【早期对话摘要】\n${summaryContent}\n（覆盖 ${condensedCount} 条消息，节省约 ${condensedTokens - summaryTokens} tokens）`,
  });

  const summaryMeta: SummaryMemory = {
    id: generateUUID(),
    sessionId: sessionId ?? '',
    content: summaryContent,
    tokenCount: summaryTokens,
    messageCount: condensedCount,
    coveredUpToSeq: condensedCount - 1,
    createdAt: Date.now(),
  };

  return {
    messages: [summaryMsg, ...messages.slice(condenseEnd)],
    summary: summaryMeta,
  };
}
