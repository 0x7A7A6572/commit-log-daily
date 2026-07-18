import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { safeGitExecute, parseGitLog, LOG_FORMAT } from '../../shared/git.js';
import type { GitLogEntry } from '../types.js';
import { readConfig } from '../../config/store.js';

/** 最多返回的 commit 条数，超出则截断并在 truncated 字段标记 */
const MAX_COMMITS = 100;

/** 扫描本地 Git 仓库的工具 */
export const scanGitTool = tool(
  async ({ projectPath, since, until, author }) => {
    // 未传 author 时，默认取全局配置中的 author.email
    const effectiveAuthor = author ?? (readConfig().author.email || undefined);

    // 多拉一条用于检测截断（取 MAX_COMMITS + 1，结果 > MAX_COMMITS 时标记截断）
    const args: string[] = [
      'log',
      '--all',
      `--format=${LOG_FORMAT}`,
      `--since=${since}`,
      `--max-count=${MAX_COMMITS + 1}`,
    ];

    if (until) {
      args.push(`--until=${until}`);
    }
    if (effectiveAuthor) {
      args.push(`--author=${effectiveAuthor}`);
    }

    const output = await safeGitExecute(projectPath, args);
    const commits: GitLogEntry[] = parseGitLog(output);

    const truncated = commits.length > MAX_COMMITS;
    const visible = truncated ? commits.slice(0, MAX_COMMITS) : commits;

    return JSON.stringify({
      projectPath,
      totalCount: visible.length,
      truncated,
      truncatedHint: truncated
        ? `结果已截断：实际匹配 ${commits.length} 条以上，仅返回前 ${MAX_COMMITS} 条。建议缩小日期范围（since/until 更精确）以获取更完整的数据。`
        : undefined,
      commits: visible,
    });
  },
  {
    name: 'scanGit',
    description:
      '扫描指定项目在时间范围内的 Git 提交记录。返回结构化的 commit 列表，包含 hash、作者、日期、提交信息和分支名。' +
      '所有分支都会被扫描（--all）。' +
      `最多返回 ${MAX_COMMITS} 条，超出部分会被截断并在 truncated 字段标记——此时应缩小日期范围重试。`,
    schema: z.object({
      projectPath: z.string().describe('项目的绝对路径'),
      since: z.string().describe('起始日期，如 "2026-06-30" 或 "Monday"'),
      until: z.string().optional().describe('截止日期（可选），如 "2026-07-05"'),
      author: z.string().optional().describe('按作者邮箱过滤（可选），默认当前用户的配置项 author.email'),
    }),
  },
);
