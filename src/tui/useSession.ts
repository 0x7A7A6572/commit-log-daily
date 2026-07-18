import { useState, useCallback, useRef } from 'react';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { createEmptyContext } from '../agent/session.js';
import type { SessionContext, AgentPhase } from '../agent/types.js';
import { hasTaskCompleteMarker, stripTaskCompleteMarker, buildUserTip } from '../agent/base.js';
import { agentGraph } from '../agent/graph.js';
import { condenseMessages } from '../agent/condense.js';
import type { ToolCallDisplay, ChatMessage, PendingApproval } from './ChatView.js';
import type { StoredMessage } from '../session/types.js';
import { createSession, saveMessage, saveSummary, saveContext, loadSession } from '../session/store.js';
import { readConfig } from '../config/store.js';
import { Command, isInterrupted, INTERRUPT } from '@langchain/langgraph';

/** 会话 Hook 的返回值 */
interface SessionState {
  messages: ChatMessage[];
  phase: AgentPhase;
  isWaiting: boolean;
  /** 当前会话累计 token 消耗 */
  tokenUsage: SessionContext['tokenUsage'];
  handleSubmit: (text: string) => void;
  loadHistorySession: (sessionId: string) => void;
  /** 待用户审批的操作（execTool 安全确认） */
  pendingApproval: PendingApproval | null;
  /** 用户审批决策回调 */
  handleApproval: (decision: 'approve' | 'reject') => void;
}

/**
 * 从 AIMessage 中提取文本内容和思考过程
 * - DeepSeek: 思考过程在 additional_kwargs.reasoning_content
 * - 通用: content 数组中 type="reasoning" 的内容块
 * - 兜底: content 是普通字符串时直接返回
 */
function extractAIContent(msg: AIMessage): { text: string; reasoning?: string } {
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
function extractToolCalls(msg: AIMessage): ToolCallDisplay[] | undefined {
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
function extractTokenUsage(msg: AIMessage): ChatMessage['tokenUsage'] {
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
function toChatMessages(msgs: BaseMessage[]): ChatMessage[] {
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
  const [langMessages, setLangMessages] = useState<BaseMessage[]>(() => {
    const tip = buildUserTip();
    if (tip) return [new SystemMessage(tip)];
    return [];
  });
  const [phase, setPhase] = useState<AgentPhase>('collect');
  const [isWaiting, setIsWaiting] = useState<boolean>(false);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const contextRef = useRef<SessionContext>(createEmptyContext());
  const currentSessionIdRef = useRef<string | null>(null);
  const pendingTaskResetRef = useRef<boolean>(false);
  /** 保存当前 stream 的 config（含 thread_id），供中断恢复时复用 */
  const streamConfigRef = useRef<{ configurable: { thread_id: string } } | null>(null);
  /** 保存中断前的用户消息 seq，供恢复后持久化使用 */
  const interruptedStateRef = useRef<{
    userSeq: number;
    conversationMessages: BaseMessage[];
  } | null>(null);

  const handleSubmit = useCallback(
    async (text: string) => {

      const userMsg = new HumanMessage(text);
      setIsWaiting(true);

      // 检查是否需要为新任务重置
      let currentPhase: AgentPhase = phase;
      let conversationMessages: BaseMessage[];
      if (pendingTaskResetRef.current) {
        currentPhase = 'collect';
        contextRef.current = createEmptyContext();
        pendingTaskResetRef.current = false;
        // 新任务：重置对话历史和会话 ID，避免上下文污染
        currentSessionIdRef.current = null;
        setLangMessages([userMsg]);
        conversationMessages = [];
      } else {
        setLangMessages([...langMessages, userMsg]);
        conversationMessages = langMessages.filter((m: BaseMessage) => m.getType() !== 'system');
      }

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

        // 检查是否已配置 API Key
        const config = readConfig();
        if (!config.model.apiKey) {
          setLangMessages((prev: BaseMessage[]) => [
            ...prev,
            new AIMessage(
              '⚠️ 尚未配置 API Key，请先完成初始化配置。\n\n' +
              '使用 /config 打开配置页面，填写以下信息：\n' +
              '  • API Key — 你的大模型 API 密钥\n' +
              '  • Base URL — API 端点地址\n' +
              '  • Model — 模型名称\n\n' +
              '也可以设置环境变量 AI_API_KEY、AI_BASE_URL、AI_MODEL。',
            ),
          ]);
          setIsWaiting(false);
          return;
        }

        // 流式运行 Agent 图，streamMode: "values" 每个超步后 yield 完整状态快照
        // 实现逐步渲染——用户看到工具调用逐条出现，而非一次性蹦出
        // 使用 thread_id 支持 checkpointer 的中断/恢复
        const threadId = currentSessionIdRef.current ?? `thread-${Date.now()}`;
        const streamConfig = {
          streamMode: "values" as const,
          recursionLimit: 20,
          configurable: { thread_id: threadId },
        };
        streamConfigRef.current = streamConfig;

        // 预处理：压缩早期对话历史（仅当窗口接近上限时触发）
        // 在进入 graph 前做一次摘要，避免工具循环中重复计算
        // 不传 model → condenseMessages 内部自动创建裸 ChatOpenAI 实例
        const { messages: condensedMessages, summary } = await condenseMessages(
          conversationMessages,
          undefined,
          undefined,
          currentSessionIdRef.current ?? undefined,
        );

        // 如果生成了摘要，立即持久化
        if (summary && currentSessionIdRef.current) {
          saveSummary(currentSessionIdRef.current, summary);
        }

        const stream = await agentGraph.stream(
          {
            messages: [...condensedMessages, userMsg],
            phase: currentPhase,
          },
          streamConfig,
        );

        let resultMessages: BaseMessage[] = [];
        let newPhase: AgentPhase = currentPhase;
        // 记录已累计过 token 的消息 ID，跨 chunk 去重
        const countedTokenIds = new Set<string>();

        for await (const chunk of stream) {
          // chunk 类型: { messages: BaseMessage[]; phase: AgentPhase } 或含 __interrupt__
          const state = chunk as unknown as { messages: BaseMessage[]; phase: AgentPhase };
          resultMessages = state.messages;
          newPhase = state.phase;

          // 检测中断：execTool 的安全审批需要用户确认
          if (isInterrupted(state)) {
            const interruptList = (state as Record<string, unknown>)[INTERRUPT] as Array<{ value: PendingApproval }> | undefined;
            const interruptData = interruptList?.[0];
            if (interruptData?.value && interruptData.value.command) {
              setPendingApproval(interruptData.value);
              interruptedStateRef.current = { userSeq, conversationMessages };
              // 不持久化、不设 isWaiting=false — 等待用户审批
              return;
            }
            // 非审批类中断：跳过，继续处理
            continue;
          }

          // 仅对未累计过的 AIMessage 累加 token（同一消息可能在多个 chunk 中出现）
          for (const msg of resultMessages) {
            if (
              msg instanceof AIMessage &&
              msg.usage_metadata?.input_tokens != null &&
              msg.id &&
              !countedTokenIds.has(msg.id)
            ) {
              countedTokenIds.add(msg.id);
              contextRef.current.tokenUsage.input_tokens += msg.usage_metadata.input_tokens;
              contextRef.current.tokenUsage.output_tokens += msg.usage_metadata.output_tokens ?? 0;
            }
          }

          // 实时更新 UI —— 每个超步用户都能看到新消息
          setLangMessages(resultMessages);
          setPhase(newPhase);
        }

        // 检测任务完成标记，为下一轮重置做准备
        const resultAiMessages = resultMessages.filter(
          (m: BaseMessage) => m.getType() === 'ai',
        );
        const lastAiMsg = resultAiMessages[resultAiMessages.length - 1];
        if (lastAiMsg) {
          const aiContent = typeof lastAiMsg.content === 'string' ? lastAiMsg.content : '';
          if (hasTaskCompleteMarker(aiContent)) {
            pendingTaskResetRef.current = true;
            // 原地 strip 标记，确保持久化和 UI 渲染都不带标记
            lastAiMsg.content = stripTaskCompleteMarker(aiContent);
          }
        }

        // 持久化本轮新增消息（流结束后一次性写入）
        // 偏移量 = condensedMessages（传给 graph 的消息条数） + 用户新消息（1）
        const graphInputCount = condensedMessages.length + 1;
        const newMessages = resultMessages.slice(graphInputCount);
        let msgSeq = userSeq + 1;
        for (const msg of newMessages) {
          const msgType = msg.getType();
          if (msgType === 'ai' || msgType === 'tool') {
            const role = msgType === 'ai' ? 'ai' as const : 'tool' as const;
            saveMessage(currentSessionIdRef.current, role, serializeMessage(msg), msgSeq++);
          }
        }

        // 保存上下文
        saveContext(currentSessionIdRef.current, newPhase, contextRef.current);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        const isCredentialError =
          errMsg.includes('Missing credentials') ||
          errMsg.includes('apiKey') ||
          errMsg.includes('API_KEY');

        const displayMsg = isCredentialError
          ? '⚠️ API Key 未配置或无效。\n\n' +
          '使用 /config 打开配置页面设置 API Key，或设置环境变量 AI_API_KEY。'
          : `执行出错: ${errMsg}`;

        setLangMessages((prev: BaseMessage[]) => [
          ...prev,
          new AIMessage(displayMsg),
        ]);
      } finally {
        setIsWaiting(false);
      }
    },
    [langMessages, phase],
  );

  /** 处理安全审批：用户确认/拒绝后恢复图执行 */
  const handleApproval = useCallback(
    async (decision: 'approve' | 'reject') => {
      setPendingApproval(null);
      const config = streamConfigRef.current;
      const interrupted = interruptedStateRef.current;
      if (!config || !interrupted) return;

      try {
        // 用 Command(resume) 恢复被 interrupt() 暂停的图
        const stream = await agentGraph.stream(
          new Command({ resume: { decision } }),
          config,
        );

        let resultMessages: BaseMessage[] = [];
        let newPhase: AgentPhase = 'collect';
        const countedTokenIds = new Set<string>();

        for await (const chunk of stream) {
          const state = chunk as unknown as { messages: BaseMessage[]; phase: AgentPhase };

          // 可能再次中断（多个 execTool 调用）
          if (isInterrupted(state)) {
            const interruptList = (state as Record<string, unknown>)[INTERRUPT] as Array<{ value: PendingApproval }> | undefined;
            const interruptData = interruptList?.[0];
            if (interruptData?.value && interruptData.value.command) {
              setPendingApproval(interruptData.value);
              // 更新中断状态，保存最新消息
              interruptedStateRef.current = {
                userSeq: interrupted.userSeq,
                conversationMessages: interrupted.conversationMessages,
              };
              return;
            }
            continue;
          }

          resultMessages = state.messages;
          newPhase = state.phase;

          for (const msg of resultMessages) {
            if (
              msg instanceof AIMessage &&
              msg.usage_metadata?.input_tokens != null &&
              msg.id &&
              !countedTokenIds.has(msg.id)
            ) {
              countedTokenIds.add(msg.id);
              contextRef.current.tokenUsage.input_tokens += msg.usage_metadata.input_tokens;
              contextRef.current.tokenUsage.output_tokens += msg.usage_metadata.output_tokens ?? 0;
            }
          }

          setLangMessages(resultMessages);
          setPhase(newPhase);
        }

        // 恢复后完成：检测任务标记 + 持久化
        const resultAiMessages = resultMessages.filter(
          (m: BaseMessage) => m.getType() === 'ai',
        );
        const lastAiMsg = resultAiMessages[resultAiMessages.length - 1];
        if (lastAiMsg) {
          const aiContent = typeof lastAiMsg.content === 'string' ? lastAiMsg.content : '';
          if (hasTaskCompleteMarker(aiContent)) {
            pendingTaskResetRef.current = true;
            lastAiMsg.content = stripTaskCompleteMarker(aiContent);
          }
        }

        // 持久化：只存中断之后新增的消息
        const newMessages = resultMessages.slice(interrupted.conversationMessages.length);
        let msgSeq = interrupted.userSeq + 1;
        for (const msg of newMessages) {
          const msgType = msg.getType();
          if (msgType === 'ai' || msgType === 'tool') {
            const role = msgType === 'ai' ? 'ai' as const : 'tool' as const;
            saveMessage(currentSessionIdRef.current!, role, serializeMessage(msg), msgSeq++);
          }
        }

        saveContext(currentSessionIdRef.current!, newPhase, contextRef.current);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        setLangMessages((prev: BaseMessage[]) => [
          ...prev,
          new AIMessage(`执行出错: ${errMsg}`),
        ]);
      } finally {
        setIsWaiting(false);
        streamConfigRef.current = null;
        interruptedStateRef.current = null;
      }
    },
    [],
  );

  /** 从历史恢复会话 */
  const loadHistorySession = useCallback(
    (sessionId: string) => {
      const full = loadSession(sessionId);
      if (!full) return;

      // 还原消息
      const restored: BaseMessage[] = full.messages.map(deserializeMessage);

      // 如果有持久化的摘要且 messages 为空（被摘要全覆盖），插入摘要消息
      if (full.summary && restored.length === 0) {
        restored.push(
          new AIMessage({
            content: `【早期对话摘要】\n${full.summary.content}\n（覆盖 ${full.summary.messageCount} 条消息，节省约 ${full.summary.tokenCount} tokens）`,
          }),
        );
      }

      setLangMessages(restored);
      setPhase(full.phase);
      // 合并默认值，兼容旧版本缺少 tokenUsage 等字段的会话
      contextRef.current = { ...createEmptyContext(), ...full.context };

      // 检查恢复的会话最后一条 AI 消息是否包含 [TASK_COMPLETE]
      const restoredAiMessages = restored.filter(
        (m: BaseMessage) => m.getType() === 'ai',
      );
      const lastRestoredAi = restoredAiMessages[restoredAiMessages.length - 1];
      if (
        lastRestoredAi &&
        typeof lastRestoredAi.content === 'string' &&
        hasTaskCompleteMarker(lastRestoredAi.content)
      ) {
        lastRestoredAi.content = stripTaskCompleteMarker(lastRestoredAi.content);
        pendingTaskResetRef.current = true;
      }

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
    tokenUsage: contextRef.current.tokenUsage,
    handleSubmit,
    loadHistorySession,
    pendingApproval,
    handleApproval,
  };
}
