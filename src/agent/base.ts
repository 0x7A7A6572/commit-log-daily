import type { BaseMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { readConfig } from '../config/store.js';
import { readPreferences } from '../config/prefs.js';
import { normalizeBaseUrl } from '../shared/utils.js';
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
import { BASE_SYSTEM_PROMPT, COLLECT_SYSTEM_PROMPT, GENERATE_SYSTEM_PROMPT } from './prompts/system.js';
import { resolveTemplateForPrompt } from '../template/resolver.js';
import { generateReportTool } from './tools/generate.js';
import { updatePreferenceTool } from './tools/preferences.js';

// 常驻工具
export const BASE_TOOLS = [
  getConfigTool,
  setConfigTool,
  execTool,
  listTemplatesTool,
  readTemplateTool,
  createTemplateTool,
  updateTemplateTool,
  deleteTemplateTool,
  setDefaultTemplateTool,
]

/** collect 阶段可用工具 */
export const COLLECT_TOOLS = [
  ...BASE_TOOLS,
  scanGitTool,
  scanUncommittedTool,
  listProjectsTool,
  addProjectTool,
  removeProjectTool,
  findGitReposTool,
  updatePreferenceTool,
];

/** generate 阶段可用工具（BASE_TOOLS 已包含 execTool，无需重复） */
export const GENERATE_TOOLS = [
  ...BASE_TOOLS,
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

const TIME_RANGE_LABEL: Record<string, string> = {
  daily: '日报', weekly: '周报', monthly: '月报',
};

/**
 * 从用户偏好统计生成 prompt 提示段
 * 作为 collect 阶段的决策依据，帮助 Agent 快速启动
 */
export function buildPreferenceHint(): string {
  const pref = readPreferences();

  // 按 count 降序排列
  const sorted = [...pref.tasks].sort((a, b) => b.count - a.count);
  if (sorted.length === 0) return '';

  const hints: string[] = [];

  // Top 3 完整行为模式
  const top3 = sorted.slice(0, 3);
  const patterns = top3.map((t) => {
    const label = TIME_RANGE_LABEL[t.timeRangeType] ?? t.timeRangeType;
    const extra = t.hasExtraWork ? '有额外工作' : '无额外工作';
    return `  · ${t.projects.join(', ')} · ${label}(${t.timeRangeDays}天) · ${extra}（${t.count} 次）`;
  });
  hints.push(`常用任务模式（按频率排序）：\n${patterns.join('\n')}`);

  // 统计总体额外工作比例
  const totalCount = sorted.reduce((sum, t) => sum + t.count, 0);
  const noExtraCount = sorted
    .filter((t) => !t.hasExtraWork)
    .reduce((sum, t) => sum + t.count, 0);
  if (totalCount >= 3 && noExtraCount / totalCount >= 0.75) {
    hints.push('用户通常没有额外工作，可直接跳过步骤 5 的询问');
  }

  return (
    '\n【用户偏好 — 基于历史统计】\n' +
    '以下是用户历史使用习惯，可供第一阶段快速决策：\n' +
    hints.join('\n') +
    '\n' +
    '【偏好使用规则 — 重要】\n' +
    '用户说「生成周报」「生成日报」「生成月报」等简洁指令时，不要从头收集。\n' +
    '先在上方偏好列表中找匹配该报告类型的模式，命中后直接反问确认：\n' +
    '  "我看到你常用 {项目列表} 生成{报告类型}，直接按这个来？"\n' +
    '用户确认后，跳过步骤 2-5，直接用偏好中的项目和日期范围进入生成阶段。\n' +
    '用户说「换个项目」或「改下时间」时，按新指示调整，不坚持偏好。\n\n'
  );
}

/**
 * 从用户偏好统计生成面向用户的欢迎提示
 * 在新会话创建时展示，让用户知道系统记住了使用习惯
 * 无有效偏好时返回空字符串
 */
export function buildUserTip(): string {
  const pref = readPreferences();

  // 总任务数不足 2 次，不展示
  const totalCount = pref.tasks.reduce((sum, t) => sum + t.count, 0);
  if (totalCount < 2) return '';

  // 取最频繁的模式
  const top = [...pref.tasks].sort((a, b) => b.count - a.count)[0];
  if (!top) return '';

  // 统计额外工作比例
  const noExtraCount = pref.tasks
    .filter((t) => !t.hasExtraWork)
    .reduce((sum, t) => sum + t.count, 0);
  const skipExtra = totalCount >= 3 && noExtraCount / totalCount >= 0.75;

  const rangeLabel = TIME_RANGE_LABEL[top.timeRangeType] ?? '报告';

  // 项目列表：A、B 和 C
  const projectList = top.projects.length === 1
    ? top.projects[0]
    : top.projects.slice(0, -1).join('、') + ' 和 ' + top.projects[top.projects.length - 1];

  const extraLine = skipExtra
    ? '既然没有额外安排，我就直接按常规帮你准备啦。\n'
    : '';

  return (
    `嗨，欢迎回来！我帮你记着习惯呢：\n` +
    `最近你常写${rangeLabel}，主要关注 ${projectList} 这几个项目。\n` +
    extraLine +
    `随时发一句「生成${rangeLabel}」就能开始，想换口味也听你的~`
  );
}

/**
 * 根据阶段创建 ChatOpenAI 实例 + System Prompt
 * 每次调用重新读取配置，确保使用最新配置（含对话中修改）
 *
 * 同时注入用户偏好统计，供 Agent 在新任务启动时参考。
 */
export function createModelForPhase(phase: AgentPhase): PhaseModel {
  const config = readConfig();

  // 规范化 baseUrl：确保以 /v1 结尾（兼容用户漏写 /v1 的情况）
  const baseUrl = normalizeBaseUrl(config.model.baseUrl);

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
  const systemPrompt = phase === 'collect'
    ? BASE_SYSTEM_PROMPT + '\n\n' + buildPreferenceHint() + COLLECT_SYSTEM_PROMPT
    : BASE_SYSTEM_PROMPT + '\n\n' + buildGeneratePrompt();

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
