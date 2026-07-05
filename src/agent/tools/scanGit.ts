import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { GitExecutionError } from '../../shared/errors.js';
import type { GitLogEntry } from '../types.js';

const execFileAsync = promisify(execFile);

/** Git 只读子命令白名单 */
const ALLOWED_COMMANDS: string[] = ['log', 'branch', 'diff', 'show', 'status'];

/**
 * 安全执行本地 Git 命令
 * 使用 execFile + 数组传参，不经过 Shell，杜绝命令注入
 */
async function safeGitExecute(projectPath: string, args: string[]): Promise<string> {
  if (!path.isAbsolute(projectPath)) {
    throw new GitExecutionError(
      `路径必须是绝对路径，收到 "${projectPath}"`,
      projectPath,
      args,
    );
  }

  const subCommand = args[0];
  if (!subCommand || !ALLOWED_COMMANDS.includes(subCommand)) {
    throw new GitExecutionError(
      `不允许执行 git ${subCommand ?? 'undefined'}，仅支持 ${ALLOWED_COMMANDS.join(', ')}`,
      projectPath,
      args,
    );
  }

  const { stdout, stderr } = await execFileAsync('git', ['-C', projectPath, ...args]);

  if (stderr) {
    return `Git 警告: ${stderr}\n输出: ${stdout}`;
  }
  return stdout;
}

/**
 * 解析 git log 格式化输出为结构化数组
 * 输入格式: %H|%an|%ai|%s|%D
 */
function parseGitLog(raw: string): GitLogEntry[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  return trimmed.split('\n').map((line) => {
    const parts = line.split('|');
    return {
      hash: (parts[0] ?? '').trim(),
      author: (parts[1] ?? '').trim(),
      date: (parts[2] ?? '').trim(),
      message: (parts[3] ?? '').trim(),
      branch: (parts[4] ?? '').trim(),
    };
  });
}

/** Git log 格式化字符串：hash|作者|日期|提交信息|引用 */
const LOG_FORMAT = '%H|%an|%ai|%s|%D';

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
    const commits = parseGitLog(output);

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
