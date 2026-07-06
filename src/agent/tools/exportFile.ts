import fs from 'node:fs';
import path from 'node:path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { readConfig } from '../../config/store.js';

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

/** 将内容写入磁盘保存为文件的工具 */
export const writeFileTool = tool(
  async ({ content, filename, customOutput }) => {
    const config = readConfig();
    const outputDir = customOutput || config.report.outputDir || process.cwd();

    // 确保输出目录存在（自动递归创建）
    fs.mkdirSync(outputDir, { recursive: true });

    const safeName = sanitizeFilename(filename || `report_${Date.now()}`);
    const filePath = path.join(outputDir, `${safeName}.md`);

    fs.writeFileSync(filePath, content, 'utf-8');

    return `文件已写入: ${filePath}`;
  },
  {
    name: 'writeFile',
    description: '将内容写入磁盘保存为文件。支持写入任意文本内容到指定路径。',
    schema: z.object({
      content: z.string().describe('要写入的文件内容'),
      filename: z.string().optional().describe('文件名（不含扩展名），默认使用时间戳'),
      customOutput: z.string().optional().describe('自定义输出目录，默认使用配置文件中的输出目录'),
    }),
  },
);
