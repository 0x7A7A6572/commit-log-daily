import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { safeGitExecute, parseGitLog, LOG_FORMAT } from '../../shared/git.js';
import type { GitLogEntry } from '../types.js';

/** 扫描本地 Git 仓库的工具 */
export const scanGitTool = tool(
  async ({ projectPath, since, until, author }) => {
    const args: string[] = [
      'log',
      '--all',
      `--format=${LOG_FORMAT}`,
      `--since=${since}`,
    ];

    if (until) {
      args.push(`--until=${until}`);
    }
    if (author) {
      args.push(`--author=${author}`);
    }

    const output = await safeGitExecute(projectPath, args);
    const commits: GitLogEntry[] = parseGitLog(output);

    return JSON.stringify({
      projectPath,
      commitCount: commits.length,
      commits,
    });
  },
  {
    name: 'scanGit',
    description:
      '扫描指定项目在时间范围内的 Git 提交记录。返回结构化的 commit 列表，包含 hash、作者、日期、提交信息和分支名。所有分支都会被扫描（--all）。',
    schema: z.object({
      projectPath: z.string().describe('项目的绝对路径'),
      since: z.string().describe('起始日期，如 "2026-06-30" 或 "Monday"'),
      until: z.string().optional().describe('截止日期（可选），如 "2026-07-05"'),
      author: z.string().optional().describe('按作者邮箱过滤（可选），默认不限制'),
    }),
  },
);
