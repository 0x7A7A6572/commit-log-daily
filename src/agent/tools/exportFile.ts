import fs from 'node:fs';
import path from 'node:path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { readConfig } from '../../config/store.js';
import { AgentToolError } from '../../shared/errors.js';

/**
 * 生成安全的文件名
 * 将空格和特殊字符替换为下划线
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 200);
}

/** 导出 Markdown 报告到文件的工具 */
export const exportFileTool = tool(
  async ({ content, filename }) => {
    const config = readConfig();
    const outputDir = config.report.outputDir || process.cwd();

    // 确保输出目录存在
    if (!fs.existsSync(outputDir)) {
      throw new AgentToolError(
        `输出目录不存在: ${outputDir}`,
        'exportFile',
      );
    }

    const safeName = sanitizeFilename(filename || `report_${Date.now()}`);
    const filePath = path.join(outputDir, `${safeName}.md`);

    fs.writeFileSync(filePath, content, 'utf-8');

    return `报告已导出到: ${filePath}`;
  },
  {
    name: 'exportFile',
    description: '将报告内容导出为 Markdown 文件。',
    schema: z.object({
      content: z.string().describe('要导出的 Markdown 文本内容'),
      filename: z.string().optional().describe('文件名（不含扩展名），默认使用时间戳'),
    }),
  },
);
