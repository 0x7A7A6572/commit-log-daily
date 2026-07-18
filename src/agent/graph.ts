import { Annotation, messagesStateReducer, StateGraph, START, END } from '@langchain/langgraph';
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt';
import { SystemMessage, AIMessage, trimMessages } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { createModelForPhase, COLLECT_TOOLS, GENERATE_TOOLS } from './base.js';
import type { PhaseModel } from './base.js';
import { createSqliteSaver } from './checkpoint-sqlite.js';

/**
 * Agent 状态定义
 * messages 使用 LangGraph 内置的 messagesStateReducer 自动累积
 * phase 使用替换模式（取最新值）
 */
const AgentStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  phase: Annotation<'collect' | 'generate'>({
    reducer: (_current: 'collect' | 'generate', next: 'collect' | 'generate'): 'collect' | 'generate' => next,
    default: () => 'collect' as const,
  }),
});

/**
 * 构建裁剪后的消息列表：System Prompt 前置 + 历史对话 + trimMessages 裁剪
 * collect 和 generate 节点共用此逻辑，避免裁剪策略变更时不同步
 */
async function buildTrimmedMessages(
  state: typeof AgentStateAnnotation.State,
  phaseModel: PhaseModel,
): Promise<BaseMessage[]> {
  const conversationMessages = state.messages.filter((m: BaseMessage) => m.getType() !== 'system');
  const systemMessages: BaseMessage[] = [
    new SystemMessage(phaseModel.systemPrompt),
    ...conversationMessages,
  ];
  const trimmed = await trimMessages(systemMessages, {
    maxTokens: phaseModel.maxContextTokens,
    tokenCounter: phaseModel.model,
    strategy: 'last',
    startOn: 'human',
    includeSystem: true,
  });

  // 裁剪后修复：移除没有对应 ToolMessage 的 AIMessage(tool_calls)
  // trimMessages 按 token 计数裁剪，可能保留 AIMessage 但丢弃其 ToolMessage，导致 API 400 错误
  return fixOrphanedToolCalls(trimmed);
}

/**
 * 确保每条带 tool_calls 的 AIMessage 都有对应的 ToolMessage 跟随
 * 如果裁剪破坏了配对，移除孤立的 AIMessage(tool_calls)
 */
function fixOrphanedToolCalls(messages: BaseMessage[]): BaseMessage[] {
  const toolCallIdsWithResult = new Set<string>();
  for (const msg of messages) {
    if (msg.getType() === 'tool') {
      const toolMsg = msg as unknown as { tool_call_id: string };
      if (toolMsg.tool_call_id) {
        toolCallIdsWithResult.add(toolMsg.tool_call_id);
      }
    }
  }
  return messages.filter((msg) => {
    if (msg instanceof AIMessage && msg.tool_calls && msg.tool_calls.length > 0) {
      return msg.tool_calls.every((tc) => tc.id ? toolCallIdsWithResult.has(tc.id) : false);
    }
    return true;
  });
}

/**
 * 收集阶段 LLM 节点
 * 每次调用重新创建模型实例，确保配置变更即时生效
 */
async function collectLLMNode(
  state: typeof AgentStateAnnotation.State,
): Promise<Partial<typeof AgentStateAnnotation.State>> {
  const phaseModel = createModelForPhase('collect');
  const trimmed = await buildTrimmedMessages(state, phaseModel);
  const response = await phaseModel.invoke(trimmed);
  return { messages: [response] };
}

/**
 * 生成阶段 LLM 节点
 */
async function generateLLMNode(
  state: typeof AgentStateAnnotation.State,
): Promise<Partial<typeof AgentStateAnnotation.State>> {
  const phaseModel = createModelForPhase('generate');
  const trimmed = await buildTrimmedMessages(state, phaseModel);
  const response = await phaseModel.invoke(trimmed);
  return { messages: [response], phase: 'generate' as const };
}

/**
 * 收集阶段路由：决定下一步走向
 * - 有 tool_calls → 执行工具
 * - 有 [PHASE:generate] 标记 → 切换到生成阶段
 * - 否则 → 结束（等待用户输入）
 */
function routeAfterCollectLLM(
  state: typeof AgentStateAnnotation.State,
): 'collectTools' | 'generateLLM' | typeof END {
  const lastMsg = state.messages[state.messages.length - 1];
  if (!lastMsg) return END;

  // 检查是否有 tool_calls
  if (lastMsg instanceof AIMessage && lastMsg.tool_calls && lastMsg.tool_calls.length > 0) {
    return 'collectTools';
  }

  // 检查是否包含阶段切换标记
  const content = typeof lastMsg.content === 'string' ? lastMsg.content : '';
  if (content.includes('[PHASE:generate]')) {
    return 'generateLLM';
  }

  return END;
}

/**
 * 生成阶段路由：包装内建 toolsCondition，映射 "tools" 到 "generateTools"
 */
function routeAfterGenerateLLM(
  state: typeof AgentStateAnnotation.State,
): 'generateTools' | typeof END {
  const result = toolsCondition(state);
  if (result === 'tools') return 'generateTools';
  return result;
}

/**
 * 起始路由：根据初始状态中的 phase 决定从哪个节点开始
 */
function routeStart(
  state: typeof AgentStateAnnotation.State,
): 'collectLLM' | 'generateLLM' {
  return state.phase === 'generate' ? 'generateLLM' : 'collectLLM';
}

/** 编译后的 Agent 图 */
export const agentGraph = new StateGraph(AgentStateAnnotation)
  .addNode('collectLLM', collectLLMNode)
  .addNode('collectTools', new ToolNode(COLLECT_TOOLS))
  .addNode('generateLLM', generateLLMNode)
  .addNode('generateTools', new ToolNode(GENERATE_TOOLS))

  // 起始路由：根据 phase 选择入口
  .addConditionalEdges(START, routeStart, ['collectLLM', 'generateLLM'])

  // 收集阶段：LLM → 工具 或 切换 或 结束
  .addConditionalEdges('collectLLM', routeAfterCollectLLM, [
    'collectTools',
    'generateLLM',
    END,
  ])
  .addEdge('collectTools', 'collectLLM')

  // 生成阶段：LLM → 工具 或 结束
  .addConditionalEdges('generateLLM', routeAfterGenerateLLM, [
    'generateTools',
    END,
  ])
  .addEdge('generateTools', 'generateLLM')

  .compile({
     checkpointer: createSqliteSaver()
  });

export { AgentStateAnnotation };
