import { ChatOpenAI } from '@langchain/openai';
import { readConfig } from '../config/store.js';
import type { AgentPhase } from './types.js';

import { scanGitTool } from './tools/scanGit.js';
import { listProjectsTool, addProjectTool, removeProjectTool } from './tools/projects.js';
import { getConfigTool, setConfigTool } from './tools/config-tool.js';
import { exportFileTool } from './tools/exportFile.js';
import { generateReportTool } from './tools/generate.js';
import { COLLECT_SYSTEM_PROMPT, GENERATE_SYSTEM_PROMPT } from './prompts/system.js';

/** collect 阶段可用工具 */
const COLLECT_TOOLS = [
  scanGitTool,
  listProjectsTool,
  addProjectTool,
  removeProjectTool,
  getConfigTool,
  setConfigTool,
];

/** generate 阶段可用工具 */
const GENERATE_TOOLS = [
  generateReportTool,
  exportFileTool,
];

/**
 * 根据阶段创建对应的 ChatOpenAI 实例
 * 每次调用重新读取配置，确保使用最新配置（含对话中修改）
 */
export function createModelForPhase(phase: AgentPhase): ReturnType<ChatOpenAI['bindTools']> {
  const config = readConfig();

  const model = new ChatOpenAI({
    model: config.model.model,
    temperature: 0,
    configuration: {
      baseURL: config.model.baseUrl,
      apiKey: config.model.apiKey,
    },
  });

  const tools = phase === 'collect' ? COLLECT_TOOLS : GENERATE_TOOLS;

  // 绑定工具
  return model.bindTools(tools);
}

/** 将 Agent 原始响应中的 [PHASE:generate] 标记移除，返回清洗后的文本 */
export function stripPhaseMarker(content: string): string {
  return content.replace(new RegExp(`\\n?\\[PHASE:generate\\]\\s*$`, 'g'), '').trim();
}

/** 检测 Agent 响应中是否包含阶段切换标记 */
export function hasPhaseMarker(content: string): boolean {
  return content.includes('[PHASE:generate]');
}
