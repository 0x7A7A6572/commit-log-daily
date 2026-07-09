import type { BaseMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { readConfig } from '../config/store.js';
import type { AgentPhase } from './types.js';

import { scanGitTool } from './tools/scanGit.js';
import { scanUncommittedTool } from './tools/scanUncommitted.js';
import { listProjectsTool, addProjectTool, removeProjectTool } from './tools/projects.js';
import { getConfigTool, setConfigTool } from './tools/config-tool.js';
import { writeFileTool } from './tools/exportFile.js';
import { findGitReposTool } from './tools/findGitRepos.js';
import { execTool } from './tools/exec.js';
import {
  listTemplatesTool,
  readTemplateTool,
  createTemplateTool,
  updateTemplateTool,
  deleteTemplateTool,
  setDefaultTemplateTool,
} from './tools/template-tool.js';
import { COLLECT_SYSTEM_PROMPT, GENERATE_SYSTEM_PROMPT } from './prompts/system.js';
import { resolveTemplateForPrompt } from '../template/resolver.js';
import { generateReportTool } from './tools/generate.js';

/** collect 阶段可用工具 */
export const COLLECT_TOOLS = [
  scanGitTool,
  scanUncommittedTool,
  listProjectsTool,
  addProjectTool,
  removeProjectTool,
  getConfigTool,
  setConfigTool,
  findGitReposTool,
  execTool,
  listTemplatesTool,
  readTemplateTool,
  createTemplateTool,
  updateTemplateTool,
  deleteTemplateTool,
  setDefaultTemplateTool,
];

/** generate 阶段可用工具 */
export const GENERATE_TOOLS = [
  writeFileTool,
  generateReportTool,
];

/** createModelForPhase 的返回值类型 */
export interface PhaseModel {
  invoke: (messages: BaseMessage[]) => Promise<BaseMessage>;
  systemPrompt: string;
  /** ChatOpenAI 实例，供 trimMessages 做 token 计数 */
  model: ChatOpenAI;
  /** 配置中的最大上下文 token 数 */
  maxContextTokens: number;
}

/**
 * 根据阶段创建 ChatOpenAI 实例 + System Prompt
 * 每次调用重新读取配置，确保使用最新配置（含对话中修改）
 */
export function createModelForPhase(phase: AgentPhase): PhaseModel {
  const config = readConfig();

  // 规范化 baseUrl：确保以 /v1 结尾（兼容用户漏写 /v1 的情况）
  let baseUrl = config.model.baseUrl.trim();
  if (baseUrl && !baseUrl.endsWith('/v1') && !baseUrl.endsWith('/v1/')) {
    baseUrl = baseUrl.replace(/\/$/, '') + '/v1';
  }

  const model = new ChatOpenAI({
    model: config.model.model,
    temperature: 0,
    configuration: {
      baseURL: baseUrl,
      apiKey: config.model.apiKey,
    },
  });

  const tools = phase === 'collect' ? COLLECT_TOOLS : GENERATE_TOOLS;
  const runnable = model.bindTools(tools);
  const systemPrompt = phase === 'collect' ? COLLECT_SYSTEM_PROMPT : buildGeneratePrompt();

  return {
    invoke: (messages: BaseMessage[]) => runnable.invoke(messages),
    systemPrompt,
    model,
    maxContextTokens: config.model.maxContextTokens,
  };
}

/**
 * 构建 generate 阶段 System Prompt
 * 优先使用用户自定义模板，否则使用内置 GENERATE_SYSTEM_PROMPT
 */
function buildGeneratePrompt(): string {
  const resolved = resolveTemplateForPrompt();

  if (!resolved) {
    return GENERATE_SYSTEM_PROMPT;
  }

  const parts: string[] = [GENERATE_SYSTEM_PROMPT];

  if (resolved.promptFragment) {
    parts.push(resolved.promptFragment);
  }

  if (resolved.skeletonFragment) {
    parts.push(resolved.skeletonFragment);
  }

  return parts.join('\n\n');
}

/** 将 Agent 原始响应中的 [PHASE:generate] 标记移除，返回清洗后的文本 */
export function stripPhaseMarker(content: string): string {
  return content.replace(new RegExp(`\\n?\\[PHASE:generate\\]\\s*$`, 'g'), '').trim();
}

/** 检测 Agent 响应中是否包含阶段切换标记 */
export function hasPhaseMarker(content: string): boolean {
  return content.includes('[PHASE:generate]');
}

/** 检测 Agent 响应中是否包含任务完成标记 */
export function hasTaskCompleteMarker(content: string): boolean {
  return content.includes('[TASK_COMPLETE]');
}

/** 将 Agent 原始响应中的 [TASK_COMPLETE] 标记移除，返回清洗后的文本 */
export function stripTaskCompleteMarker(content: string): string {
  return content.replace(new RegExp(`\\n?\\[TASK_COMPLETE\\]\\s*$`, 'gm'), '').trim();
}
