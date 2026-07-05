import { useState, useCallback, useRef } from 'react';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { createModelForPhase } from '../agent/base.js';
import type { PhaseModel } from '../agent/base.js';
import {
  createEmptyContext,
  evaluatePhaseTransition,
} from '../agent/session.js';
import type { SessionContext, AgentPhase } from '../agent/types.js';
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
          userSeq = langMessages.filter((m) => m.getType() !== 'system').length;
        }
        saveMessage(currentSessionIdRef.current, 'human', serializeMessage(userMsg), userSeq);

        const phaseModel = createModelForPhase(phase);
        let msgSeq = userSeq + 1;

        // 工具调用循环：只要 LLM 还在发 tool_calls，就继续执行并再次调用
        const MAX_TOOL_ROUNDS = 10;
        let runningMessages: BaseMessage[] = [...updated];
        // 注入 phase 对应的 System Prompt（过滤历史中的 system 消息）
        const systemMessages: BaseMessage[] = [
          new SystemMessage(phaseModel.systemPrompt),
          ...runningMessages.filter((m) => m.getType() !== 'system'),
        ];
        let currentAiMsg: BaseMessage = await phaseModel.invoke(systemMessages);
        let toolRounds = 0;

        while (true) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const currentAny = currentAiMsg as unknown as {
            content: string;
            tool_calls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
          };

          // 无工具调用或达到最大轮数 → 退出循环
          if (!currentAny.tool_calls || currentAny.tool_calls.length === 0 || toolRounds >= MAX_TOOL_ROUNDS) {
            break;
          }

          // 立即显示当前 AI 响应，避免工具执行期间用户无反馈
          setLangMessages([...runningMessages, currentAiMsg]);

          // 保存 AI 消息（含 tool_calls）
          saveMessage(currentSessionIdRef.current, 'ai', serializeMessage(currentAiMsg), msgSeq++);

          // 执行本轮工具调用
          const roundToolMessages: BaseMessage[] = [];
          for (const tc of currentAny.tool_calls) {
            const result = await executeTool(tc.name, tc.args);
            const toolMsg = new ToolMessage({ content: result, tool_call_id: tc.id });
            roundToolMessages.push(toolMsg);
            saveMessage(currentSessionIdRef.current, 'tool', serializeMessage(toolMsg), msgSeq++);
          }

          // 追加本轮 AI + Tool 消息到运行历史
          runningMessages = [...runningMessages, currentAiMsg, ...roundToolMessages];

          // 注入 System Prompt 并再次调用 LLM
          const loopSystemMessages: BaseMessage[] = [
            new SystemMessage(phaseModel.systemPrompt),
            ...runningMessages.filter((m) => m.getType() !== 'system'),
          ];
          currentAiMsg = await phaseModel.invoke(loopSystemMessages);
          toolRounds++;
        }

        // 保存最后一轮 AI 响应（纯文本或达到最大轮数）
        saveMessage(currentSessionIdRef.current, 'ai', serializeMessage(currentAiMsg), msgSeq++);

        const allMessages: BaseMessage[] = [...runningMessages, currentAiMsg];

        setLangMessages(allMessages);

        // 保存上下文
        saveContext(currentSessionIdRef.current, phase, contextRef.current);

        // 检查阶段切换
        const lastMsg = allMessages[allMessages.length - 1]!;
        const content = typeof lastMsg.content === 'string' ? lastMsg.content : '';
        handlePhaseCheck(content, phase, contextRef.current, setPhase);
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

/**
 * 执行单个工具调用
 */
async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  // 动态导入工具模块（避免循环依赖）
  const { scanGitTool } = await import('../agent/tools/scanGit.js');
  const { listProjectsTool, addProjectTool, removeProjectTool } = await import('../agent/tools/projects.js');
  const { getConfigTool, setConfigTool } = await import('../agent/tools/config-tool.js');
  const { writeFileTool } = await import('../agent/tools/exportFile.js');
  const { generateReportTool } = await import('../agent/tools/generate.js');
  const { listTemplatesTool, readTemplateTool, createTemplateTool, updateTemplateTool, deleteTemplateTool, setDefaultTemplateTool } = await import('../agent/tools/template-tool.js');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toolMap: Record<string, { invoke: (args: Record<string, unknown>) => Promise<string> }> = {
    scanGit: scanGitTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
    listProjects: listProjectsTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
    addProject: addProjectTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
    removeProject: removeProjectTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
    getConfig: getConfigTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
    setConfig: setConfigTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
    writeFile: writeFileTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
    generateReport: generateReportTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
    listTemplates: listTemplatesTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
    readTemplate: readTemplateTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
    createTemplate: createTemplateTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
    updateTemplate: updateTemplateTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
    deleteTemplate: deleteTemplateTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
    setDefaultTemplate: setDefaultTemplateTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
  };

  const tool = toolMap[name];
  if (!tool) {
    return `未知工具: ${name}`;
  }

  return tool.invoke(args);
}

/**
 * 检查并处理阶段切换
 */
function handlePhaseCheck(
  content: string,
  currentPhase: AgentPhase,
  context: SessionContext,
  setPhase: (p: AgentPhase) => void,
): void {
  const newPhase = evaluatePhaseTransition(currentPhase, content, context);
  if (newPhase !== currentPhase) {
    setPhase(newPhase);
  }
}
