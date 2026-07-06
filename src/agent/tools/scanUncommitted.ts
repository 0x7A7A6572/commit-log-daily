import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { safeGitExecute } from '../../shared/git.js';

/** 每个列表最多返回条数 */
const MAX_ITEMS = 50;

/** diff --stat 输出解析结果 */
interface DiffStatEntry {
  file: string;
  changes: number;
}

/** 未推送提交 */
interface UnpushedCommit {
  hash: string;
  message: string;
}

/** scanUncommitted 返回结构 */
interface UncommittedScanResult {
  projectPath: string;
  summary: {
    stagedCount: number;
    unstagedCount: number;
    untrackedCount: number;
    unpushedCount: number;
    stashCount: number;
    /** 被截断的字段名列表（超过 MAX_ITEMS 条） */
    truncated: string[];
  };
  stagedChanges: DiffStatEntry[];
  unstagedChanges: DiffStatEntry[];
  untrackedFiles: string[];
  unpushedCommits: UnpushedCommit[];
  stashList: string[];
}

/**
 * 解析 `git diff --stat` / `git diff --cached --stat` 输出
 * 格式: "file.ts | 5 +++--" → { file: "file.ts", changes: 5 }
 * 跳过末尾的汇总行（不含 "|"）
 */
function parseDiffStat(raw: string): DiffStatEntry[] {
  const result: DiffStatEntry[] = [];
  for (const line of raw.trim().split('\n')) {
    const pipeIdx = line.indexOf('|');
    if (pipeIdx === -1) continue; // 跳过汇总行
    const file = line.slice(0, pipeIdx).trim();
    const right = line.slice(pipeIdx + 1).trim();
    // 提取改动行数（第一个数字）
    const match = right.match(/^(\d+)/);
    const changes = match ? parseInt(match[1], 10) : 0;
    result.push({ file, changes });
  }
  return result;
}

/**
 * 解析 `git ls-files --others --exclude-standard` 输出
 * 每行一个文件路径，空输出返回空数组
 */
function parseUntrackedFiles(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return trimmed.split('\n').map((f) => f.trim()).filter(Boolean);
}

/**
 * 解析 `git log --oneline @{u}..HEAD` 输出
 * 格式: "abc1234 提交信息" → { hash: "abc1234", message: "提交信息" }
 */
function parseUnpushedCommits(raw: string): UnpushedCommit[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return trimmed.split('\n').map((line) => {
    const spaceIdx = line.indexOf(' ');
    if (spaceIdx === -1) return { hash: line, message: '' };
    return {
      hash: line.slice(0, spaceIdx).trim(),
      message: line.slice(spaceIdx + 1).trim(),
    };
  });
}

/**
 * 解析 `git stash list` 输出
 * 每行一个 stash 条目，如 "stash@{0}: WIP on master: abc1234 fix bug"
 */
function parseStashList(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return trimmed.split('\n').map((s) => s.trim()).filter(Boolean);
}

/** 扫描项目中的未提交 / 未推送代码 */
export const scanUncommittedTool = tool(
  async ({ projectPath, includeUnpushed, includeStash }) => {
    const result: UncommittedScanResult = {
      projectPath,
      summary: {
        stagedCount: 0,
        unstagedCount: 0,
        untrackedCount: 0,
        unpushedCount: 0,
        stashCount: 0,
        truncated: [],
      },
      stagedChanges: [],
      unstagedChanges: [],
      untrackedFiles: [],
      unpushedCommits: [],
      stashList: [],
    };

    // --- 暂存区变更（git diff --cached --stat） ---
    try {
      const stagedRaw = await safeGitExecute(projectPath, ['diff', '--cached', '--stat']);
      result.stagedChanges = parseDiffStat(stagedRaw);
    } catch {
      // 可能是空仓库（没有任何 commit），暂存区视为空
      result.stagedChanges = [];
    }
    // 截断
    result.summary.stagedCount = result.stagedChanges.length;
    if (result.stagedChanges.length > MAX_ITEMS) {
      result.stagedChanges = result.stagedChanges.slice(0, MAX_ITEMS);
      result.summary.truncated.push('stagedChanges');
    }

    // --- 工作区变更（git diff --stat） ---
    try {
      const unstagedRaw = await safeGitExecute(projectPath, ['diff', '--stat']);
      result.unstagedChanges = parseDiffStat(unstagedRaw);
    } catch {
      result.unstagedChanges = [];
    }
    result.summary.unstagedCount = result.unstagedChanges.length;
    if (result.unstagedChanges.length > MAX_ITEMS) {
      result.unstagedChanges = result.unstagedChanges.slice(0, MAX_ITEMS);
      result.summary.truncated.push('unstagedChanges');
    }

    // --- 未跟踪文件（git ls-files --others --exclude-standard） ---
    try {
      const untrackedRaw = await safeGitExecute(projectPath, ['ls-files', '--others', '--exclude-standard']);
      result.untrackedFiles = parseUntrackedFiles(untrackedRaw);
    } catch {
      result.untrackedFiles = [];
    }
    result.summary.untrackedCount = result.untrackedFiles.length;
    if (result.untrackedFiles.length > MAX_ITEMS) {
      result.untrackedFiles = result.untrackedFiles.slice(0, MAX_ITEMS);
      result.summary.truncated.push('untrackedFiles');
    }

    // --- 未推送提交（git log --oneline @{u}..HEAD） ---
    if (includeUnpushed) {
      try {
        const unpushedRaw = await safeGitExecute(projectPath, ['log', '--oneline', '@{u}..HEAD']);
        result.unpushedCommits = parseUnpushedCommits(unpushedRaw);
      } catch {
        // 未配置上游分支时此命令会失败，属于正常情况
        result.unpushedCommits = [];
      }
      result.summary.unpushedCount = result.unpushedCommits.length;
      if (result.unpushedCommits.length > MAX_ITEMS) {
        result.unpushedCommits = result.unpushedCommits.slice(0, MAX_ITEMS);
        result.summary.truncated.push('unpushedCommits');
      }
    }

    // --- Stash 列表（git stash list） ---
    if (includeStash) {
      try {
        const stashRaw = await safeGitExecute(projectPath, ['stash', 'list']);
        result.stashList = parseStashList(stashRaw);
      } catch {
        result.stashList = [];
      }
      result.summary.stashCount = result.stashList.length;
      if (result.stashList.length > MAX_ITEMS) {
        result.stashList = result.stashList.slice(0, MAX_ITEMS);
        result.summary.truncated.push('stashList');
      }
    }

    return JSON.stringify(result);
  },
  {
    name: 'scanUncommitted',
    description:
      '扫描项目中尚未提交或未推送的代码变更。返回暂存区、工作区、未跟踪文件、未推送提交和 stash 列表的完整概览。' +
      '用于发现开发者"正在进行中"的工作，弥补 git log 仅覆盖已提交历史的不足。' +
      '所有列表最多返回 50 条，超出部分会被截断并在 summary.truncated 中标记。',
    schema: z.object({
      projectPath: z.string().describe('项目的绝对路径'),
      includeUnpushed: z.boolean().optional().describe(
        '是否包含已提交但未推送的 commit，默认 true',
      ),
      includeStash: z.boolean().optional().describe(
        '是否包含 stash 列表，默认 true',
      ),
    }),
  },
);
