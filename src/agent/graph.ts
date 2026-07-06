import { Annotation, messagesStateReducer, StateGraph, START, END } from '@langchain/langgraph';
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt';
import { SystemMessage, AIMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { createModelForPhase, COLLECT_TOOLS, GENERATE_TOOLS } from './base.js';

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
 * 收集阶段 LLM 节点
 * 每次调用重新创建模型实例，确保配置变更即时生效
 */
async function collectLLMNode(
  state: typeof AgentStateAnnotation.State,
): Promise<Partial<typeof AgentStateAnnotation.State>> {
  const phaseModel = createModelForPhase('collect');
  // 过滤历史中的 system 消息，注入当前阶段的 System Prompt
  const conversationMessages = state.messages.filter((m: BaseMessage) => m.getType() !== 'system');
  const systemMessages: BaseMessage[] = [
    new SystemMessage(phaseModel.systemPrompt),
    ...conversationMessages,
  ];
  const response = await phaseModel.invoke(systemMessages);
  return { messages: [response] };
}

/**
 * 生成阶段 LLM 节点
 */
async function generateLLMNode(
  state: typeof AgentStateAnnotation.State,
): Promise<Partial<typeof AgentStateAnnotation.State>> {
  const phaseModel = createModelForPhase('generate');
  const conversationMessages = state.messages.filter((m: BaseMessage) => m.getType() !== 'system');
  const systemMessages: BaseMessage[] = [
    new SystemMessage(phaseModel.systemPrompt),
    ...conversationMessages,
  ];
  const response = await phaseModel.invoke(systemMessages);
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

  .compile();

export { AgentStateAnnotation };
