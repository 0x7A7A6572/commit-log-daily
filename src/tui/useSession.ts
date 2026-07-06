import { useState, useCallback, useRef } from 'react';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { createEmptyContext } from '../agent/session.js';
import type { SessionContext, AgentPhase } from '../agent/types.js';
import { agentGraph } from '../agent/graph.js';
import type { ChatMessage } from './ChatView.js';
import type { StoredMessage } from '../session/types.js';
import { createSession, saveMessage, saveContext, loadSession } from '../session/store.js';
import { WELCOME_MESSAGE } from './welcome.js';

/** 会话 Hook 的返回值 */
interface SessionState {
  messages: ChatMessage[];
  phase: AgentPhase;
  isWaiting: boolean;
  handleSubmit: (text: string) => void;
  loadHistorySession: (sessionId: string) => void;
}

/**
 * 将 LangChain 消息列表转为 UI 消息
 * 过滤工具调用的中间态（空 content 的 AI + ToolMessage），
 * 仅显示轻量指示器，不渲染原始工具输出
 */
function toChatMessages(msgs: BaseMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (const msg of msgs) {
    const msgType = msg.getType();

    // 跳过 ToolMessage，不渲染原始工具输出
    if (msgType === 'tool') continue;

    if (msgType === 'ai') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const aiAny = msg as unknown as {
        tool_calls?: Array<{ name: string }>;
      };
      const textContent = typeof msg.content === 'string' ? msg.content : '';

      if (aiAny.tool_calls && aiAny.tool_calls.length > 0 && textContent.trim() === '') {
        // 纯工具调用（无文本内容）→ 显示轻量指示器
        const toolNames = aiAny.tool_calls.map((tc) => tc.name).join('、');
        result.push({ role: 'system', content: `🔧 ${toolNames} → 执行完成` });
        continue;
      }
    }

    // 默认转换
    const roleMap: Record<string, ChatMessage['role']> = {
      human: 'user',
      ai: 'assistant',
      system: 'system',
    };
    const role = roleMap[msgType] ?? 'system';
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    result.push({ role, content });
  }

  return result;
}

/** 将 LangChain BaseMessage 序列化为存储格式 */
function serializeMessage(msg: BaseMessage): string {
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
function deserializeMessage(stored: StoredMessage): BaseMessage {
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


/**
 * 会话管理 Hook
 * 维护消息历史、阶段切换、与 Agent 交互
 */
export function useSession(): SessionState {
  const [langMessages, setLangMessages] = useState<BaseMessage[]>([
    new SystemMessage(WELCOME_MESSAGE),
  ]);
  const [phase, setPhase] = useState<AgentPhase>('collect');
  const [isWaiting, setIsWaiting] = useState<boolean>(false);
  const contextRef = useRef<SessionContext>(createEmptyContext());
  const currentSessionIdRef = useRef<string | null>(null);

  const handleSubmit = useCallback(
    async (text: string) => {
      // 追加用户消息
      const userMsg = new HumanMessage(text);
      const updated: BaseMessage[] = [...langMessages, userMsg];
      setLangMessages(updated);
      setIsWaiting(true);

      try {
        // 计算用户消息的 seq（首次为 0，后续为已有非 system 消息数）
        let userSeq: number;
        if (currentSessionIdRef.current === null) {
          const dateStr = new Date().toISOString().slice(0, 10);
          const title = `${dateStr}-${text.slice(0, 20)}`;
          currentSessionIdRef.current = createSession(title);
          userSeq = 0;
        } else {
          userSeq = langMessages.filter((m: BaseMessage) => m.getType() !== 'system').length;
        }
        saveMessage(currentSessionIdRef.current, 'human', serializeMessage(userMsg), userSeq);

        // 过滤系统消息（图内部自行注入 System Prompt）
        const conversationMessages = langMessages.filter((m: BaseMessage) => m.getType() !== 'system');

        // 运行 Agent 图（LangGraph 内部处理工具调用循环和阶段切换）
        const result = await agentGraph.invoke({
          messages: [...conversationMessages, userMsg],
          phase: phase,
        });

        const resultMessages: BaseMessage[] = result.messages;
        const newPhase: AgentPhase = result.phase;

        // 图返回的 messages 包含所有历史 + 新消息，计算增量并持久化
        const newMessages = resultMessages.slice(conversationMessages.length);
        let msgSeq = userSeq + 1;
        for (const msg of newMessages) {
          const msgType = msg.getType();
          if (msgType === 'ai' || msgType === 'tool') {
            const role = msgType === 'ai' ? 'ai' as const : 'tool' as const;
            saveMessage(currentSessionIdRef.current, role, serializeMessage(msg), msgSeq++);
          }
        }

        // 重新注入 WELCOME_MESSAGE 用于 UI 显示（图内部 System Prompt 不在结果中）
        const displayMessages: BaseMessage[] = [new SystemMessage(WELCOME_MESSAGE), ...resultMessages];
        setLangMessages(displayMessages);
        setPhase(newPhase);

        // 保存上下文
        saveContext(currentSessionIdRef.current, newPhase, contextRef.current);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        setLangMessages((prev: BaseMessage[]) => [
          ...prev,
          new AIMessage(`执行出错: ${errMsg}`),
        ]);
      } finally {
        setIsWaiting(false);
      }
    },
    [langMessages, phase],
  );

  /** 从历史恢复会话 */
  const loadHistorySession = useCallback(
    (sessionId: string) => {
      const full = loadSession(sessionId);
      if (!full) return;

      // 还原消息（不包含 system —— system 消息在下方重新注入）
      const restored: BaseMessage[] = full.messages.map(deserializeMessage);

      // 注入 SystemMessage（欢迎语）
      restored.unshift(new SystemMessage(WELCOME_MESSAGE));

      setLangMessages(restored);
      setPhase(full.phase);
      contextRef.current = full.context;
      currentSessionIdRef.current = full.id;
    },
    [],
  );

  // 转换消息为 UI 格式（过滤工具调用中间态）
  const chatMessages: ChatMessage[] = toChatMessages(langMessages);

  return {
    messages: chatMessages,
    phase,
    isWaiting,
    handleSubmit,
    loadHistorySession,
  };
}
