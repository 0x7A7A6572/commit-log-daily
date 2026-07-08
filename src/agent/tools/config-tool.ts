import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { readConfig, writeConfig } from '../../config/store.js';
import type { AppConfig } from '../../config/schema.js';

/**
 * 对 API Key 进行脱敏处理
 * 保留前 3 位和后 3 位，中间用 * 替代
 */
function maskApiKey(key: string): string {
  if (key.length <= 6) return '****';
  return `${key.slice(0, 3)}${'*'.repeat(key.length - 6)}${key.slice(-3)}`;
}

/**
 * 生成配置摘要文本
 */
function formatConfigSummary(config: AppConfig): string {
  const apiKeyDisplay = config.model.apiKey ? maskApiKey(config.model.apiKey) : '未配置';

  const lines: string[] = [
    '当前配置：',
    '',
    '【大模型】',
    `  Base URL: ${config.model.baseUrl}`,
    `  Model:    ${config.model.model}`,
    `  API Key:  ${apiKeyDisplay}`,
    '',
    '【Git 用户配置】',
    `  git user.name: ${config.author.name || '未配置'}`,
    `  git user.email: ${config.author.email || '未配置'}`,
    '',
    '【项目列表】',
  ];

  if (config.projects.length === 0) {
    lines.push('  (无已配置项目)');
  } else {
    for (const p of config.projects) {
      lines.push(`  ${p.name} → ${p.path}`);
    }
  }

  lines.push('');
  lines.push(`【输出目录】${config.report.outputDir || '当前目录'}`);
  lines.push('');
  lines.push(`【安全模式】${config.safety.safeMode ? '✅ 已开启（仅允许只读命令）' : '❌ 已关闭（允许所有命令）'}`);

  return lines.join('\n');
}

/** 查看当前配置的工具 */
export const getConfigTool = tool(
  async () => {
    const config = readConfig();
    return formatConfigSummary(config);
  },
  {
    name: 'getConfig',
    description: '查看当前的完整配置（API Key 会脱敏展示）。',
    schema: z.object({}),
  },
);

/** 更新配置的工具 */
export const setConfigTool = tool(
  async ({ section, key, value }) => {
    // 安全防护：禁止通过对话修改敏感字段，防止 LLM 被诱导泄露 API Key
    if (section === 'model' && (key === 'baseUrl' || key === 'apiKey')) {
      return `⚠️ 出于安全原因，不允许通过对话修改 ${key}。请使用 /config 命令在配置页面中手动修改。`;
    }

    const config = readConfig();

    // 按 section 定位配置块，更新指定 key
    const sectionMap: Record<string, Record<string, unknown>> = {
      model: config.model as unknown as Record<string, unknown>,
      author: config.author as unknown as Record<string, unknown>,
      report: config.report as unknown as Record<string, unknown>,
    };

    const target = sectionMap[section];
    if (!target) {
      return `未知的配置分类 "${section}"。支持: model, author, report`;
    }

    if (!(key in target)) {
      return `配置分类 "${section}" 中没有 "${key}" 字段`;
    }

    target[key] = value;
    writeConfig(config);

    // 模型 API Key 脱敏反馈
    const displayValue = (section === 'model' && key === 'apiKey') ? maskApiKey(value) : value;
    return `已更新: ${section}.${key} = ${displayValue}`;
  },
  {
    name: 'setConfig',
    description: '更新应用配置。支持更新模型、作者、输出目录等配置项。',
    schema: z.object({
      section: z
        .enum(['model', 'author', 'report'])
        .describe('配置分类：model（大模型）、author（Git 作者）、report（报告输出）'),
      key: z.string().describe('要更新的字段名，如 "apiKey", "email", "outputDir"'),
      value: z.string().describe('新的值'),
    }),
  },
);
