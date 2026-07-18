import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { ToolCallDisplay, ChatMessage } from './ChatView.js';
import type { StoredMessage } from '../session/types.js';

/**
 * 从 AIMessage 中提取文本内容和思考过程
 * - DeepSeek: 思考过程在 additional_kwargs.reasoning_content
 * - 通用: content 数组中 type="reasoning" 的内容块
 * - 兜底: content 是普通字符串时直接返回
 */
export function extractAIContent(msg: AIMessage): { text: string; reasoning?: string } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msgAny = msg as unknown as {
    additional_kwargs?: Record<string, unknown>;
    content: string | Array<{ type: string; [key: string]: unknown }>;
  };

  // 从 additional_kwargs 提取思考过程（DeepSeek R1 等模型）
  let reasoning: string | undefined;
  const ak = msgAny.additional_kwargs;
  if (ak?.reasoning_content && typeof ak.reasoning_content === 'string') {
    reasoning = ak.reasoning_content;
  }

  // content 可能是数组（ContentBlock[]）或字符串
  if (Array.isArray(msgAny.content)) {
    const textParts: string[] = [];
    for (const block of msgAny.content) {
      if (typeof block === 'object' && block !== null && 'type' in block) {
        if (block.type === 'reasoning' && !reasoning) {
          // 通用 reasoning 块兜底（仅当 additional_kwargs 没拿到时使用）
          reasoning = typeof block.reasoning === 'string' ? block.reasoning : undefined;
        } else if (block.type === 'text') {
          textParts.push(typeof block.text === 'string' ? block.text : '');
        }
      }
    }
    return { text: textParts.join(''), reasoning };
  }

  // 兜底：content 是普通字符串
  return { text: typeof msgAny.content === 'string' ? msgAny.content : '', reasoning };
}

/**
 * 从 AIMessage 中提取工具调用列表（不含结果，结果由 ToolMessage 回填）
 */
export function extractToolCalls(msg: AIMessage): ToolCallDisplay[] | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aiAny = msg as unknown as {
    tool_calls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  };
  if (!aiAny.tool_calls || aiAny.tool_calls.length === 0) return undefined;

  return aiAny.tool_calls.map((tc) => ({
    id: tc.id,
    name: tc.name,
    args: tc.args,
  }));
}

/**
 * 从 AIMessage 中提取本次调用的 token 消耗
 */
export function extractTokenUsage(msg: AIMessage): ChatMessage['tokenUsage'] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aiAny = msg as unknown as {
    usage_metadata?: { input_tokens: number; output_tokens: number };
  };
  if (aiAny.usage_metadata?.input_tokens != null) {
    return {
      input_tokens: aiAny.usage_metadata.input_tokens,
      output_tokens: aiAny.usage_metadata.output_tokens ?? 0,
    };
  }
  return undefined;
}

/**
 * 将 LangChain 消息列表转为 UI 消息
 * 完整提取：思考过程 → 工具调用（含参数和结果）→ 文本回复 → token 消耗
 */
export function toChatMessages(msgs: BaseMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (const msg of msgs) {
    const msgType = msg.getType();

    // ToolMessage → 将执行结果回填到最近一条 assistant 消息的匹配 toolCall
    if (msgType === 'tool') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolMsg = msg as unknown as {
        tool_call_id: string;
        content: string;
        status?: string;
      };
      // 倒序查找最近一条 assistant 消息，匹配 tool_call_id
      for (let i = result.length - 1; i >= 0; i--) {
        const chatMsg = result[i];
        if (chatMsg!.role === 'assistant' && chatMsg!.toolCalls) {
          const matched = chatMsg!.toolCalls.find((tc) => tc.id === toolMsg.tool_call_id);
          if (matched) {
            matched.result = typeof toolMsg.content === 'string'
              ? toolMsg.content
              : JSON.stringify(toolMsg.content);
            matched.status = toolMsg.status === 'error' ? 'error' : 'success';
            break;
          }
        }
      }
      continue;
    }

    // 默认角色映射
    const roleMap: Record<string, ChatMessage['role']> = {
      human: 'user',
      ai: 'assistant',
      system: 'system',
    };
    const role = roleMap[msgType] ?? 'system';

    // AIMessage → 完整提取思考过程、工具调用、token 消耗
    if (msgType === 'ai' && msg instanceof AIMessage) {
      const { text, reasoning } = extractAIContent(msg);
      // content 为空且无工具调用时跳过（纯中间态）
      if (text.trim() === '' && (!msg.tool_calls || msg.tool_calls.length === 0)) {
        continue;
      }
      result.push({
        id: msg.id,
        role: 'assistant',
        content: text,
        reasoning,
        toolCalls: extractToolCalls(msg),
        tokenUsage: extractTokenUsage(msg),
      });
      continue;
    }

    // HumanMessage / SystemMessage：直接转换
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msgId = (msg as unknown as { id?: string }).id;
    result.push({ id: msgId, role, content });
  }

  return result;
}

/** 将 LangChain BaseMessage 序列化为存储格式 */
export function serializeMessage(msg: BaseMessage): string {
  const role = msg.getType() as StoredMessage['role'];
  const stored: StoredMessage = {
    role,
    content: msg.content,
  };

  // AIMessage 可能携带 tool_calls
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msgAny = msg as unknown as {
    tool_calls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
    tool_call_id?: string;
  };

  if (msgAny.tool_calls) {
    stored.tool_calls = msgAny.tool_calls;
  }
  if (msgAny.tool_call_id) {
    stored.tool_call_id = msgAny.tool_call_id;
  }

  return JSON.stringify(stored);
}

/** 从存储格式还原为 LangChain BaseMessage */
export function deserializeMessage(stored: StoredMessage): BaseMessage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msgAny = stored as StoredMessage & {
    tool_calls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
    tool_call_id?: string;
  };

  switch (stored.role) {
    case 'human':
      return new HumanMessage(stored.content as string);
    case 'ai':
      if (msgAny.tool_calls && msgAny.tool_calls.length > 0) {
        return new AIMessage({
          content: typeof stored.content === 'string' ? stored.content : '',
          tool_calls: msgAny.tool_calls,
        });
      }
      return new AIMessage(stored.content as string);
    case 'tool':
      return new ToolMessage({
        content: typeof stored.content === 'string' ? stored.content : JSON.stringify(stored.content),
        tool_call_id: msgAny.tool_call_id ?? 'unknown',
      });
    default:
      return new AIMessage(stored.content as string);
  }
}
