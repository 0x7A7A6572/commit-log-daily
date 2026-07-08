import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GitExecutionError } from './errors.js';
import { readConfig } from '../config/store.js';

const execFileAsync = promisify(execFile);

/** Git 只读子命令白名单 */
export const ALLOWED_GIT_COMMANDS: string[] = [
  // 已提交历史
  'log',
  // 分支与引用（仅查询）
  'branch',
  // 差异比较
  'diff',
  // 对象内容查看
  'show',
  // 工作区状态
  'status',
  // 文件追踪
  'ls-files',
  // 暂存管理（仅 list / show）
  'stash',
  // 逐行作者溯源
  'blame',
  // tag 描述
  'describe',
  // 遍历所有引用
  'for-each-ref',
  // 在 tracked 文件中搜索文本
  'grep',
  // 列出 tree 对象内容
  'ls-tree',
  // 查找两个分支的共同祖先
  'merge-base',
  // 给定 commit 找符号名
  'name-rev',
  // 按时间倒序列出 commit 对象
  'rev-list',
  // 解析引用名（分支/tag/HEAD）
  'rev-parse',
  // 按作者汇总 git log
  'shortlog',
  // 查看引用日志
  'reflog',
  // 统计对象数量
  'count-objects',
  // 校验引用名合法性
  'check-ref-format',
  // 列出本地引用
  'show-ref',
  // 校验对象数据库完整性
  'fsck',
];

/**
 * 安全执行本地 Git 命令
 * 使用 execFile + 数组传参，不经过 Shell，杜绝命令注入
 * @param projectPath 项目的绝对路径
 * @param args git 命令参数数组，如 ['diff', '--stat']
 */
export async function safeGitExecute(projectPath: string, args: string[]): Promise<string> {
  if (!path.isAbsolute(projectPath)) {
    throw new GitExecutionError(
      `路径必须是绝对路径，收到 "${projectPath}"`,
      projectPath,
      args,
    );
  }

  const config = readConfig();
  const subCommand = args[0];

  // 安全模式开启时校验白名单
  if (config.safety.safeMode) {
    if (!subCommand || !ALLOWED_GIT_COMMANDS.includes(subCommand)) {
      throw new GitExecutionError(
        `不允许执行 git ${subCommand ?? 'undefined'}，仅支持 ${ALLOWED_GIT_COMMANDS.join(', ')}`,
        projectPath,
        args,
      );
    }
  }

  const { stdout, stderr } = await execFileAsync('git', ['-C', projectPath, ...args]);

  // 命令成功执行时，stderr 可能包含 Git 诊断输出（如进度信息）
  // 不应混入 stdout，避免下游解析器（如 parseGitLog）消费到非预期内容
  if (stderr && !stdout) {
    // stdout 为空但 stderr 有内容：某些 git 命令将结果写入 stderr
    return stderr;
  }
  return stdout;
}

/** Git log 格式化字符串：hash|作者|日期|提交信息|引用 */
export const LOG_FORMAT = '%H|%an|%ai|%s|%D';

/**
 * 解析 git log 格式化输出为结构化数组
 * 输入格式: %H|%an|%ai|%s|%D
 */
export function parseGitLog(raw: string): Array<{
  hash: string;
  author: string;
  date: string;
  message: string;
  branch: string;
}> {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  return trimmed.split('\n').map((line) => {
    const parts = line.split('|', 5);
    return {
      hash: (parts[0] ?? '').trim(),
      author: (parts[1] ?? '').trim(),
      date: (parts[2] ?? '').trim(),
      message: (parts[3] ?? '').trim(),
      branch: (parts[4] ?? '').trim(),
    };
  });
}
