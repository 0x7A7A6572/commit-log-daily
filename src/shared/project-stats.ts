import { safeGitExecute } from './git.js';

/** 时间范围 */
export type StatsRange = 'all' | '7days' | '30days';

/** 项目统计数据 */
export interface ProjectStats {
  totalCommits: number;
  activeDays: number;
  longestStreak: number;
  currentStreak: number;
  mostActiveDate: string;
  contributors: Array<{ name: string; count: number }>;
  addLines: number;
  delLines: number;
  branchCount: number;
  /** "YYYY-MM-DD" → 当日提交次数 */
  heatmap: Map<string, number>;
}

/** 根据时间范围计算 --since 参数值 */
function getSinceDate(range: StatsRange): string | null {
  switch (range) {
    case '7days':
      return '7 days ago';
    case '30days':
      return '30 days ago';
    case 'all':
      return null; // 不传 --since，获取全部历史
  }
}

/** 执行 git log 获取所有提交的日期（ISO 8601 格式） */
async function runGitLog(projectPath: string, sinceDate: string | null): Promise<string> {
  const args = ['log', '--all', '--format=%ai'];
  if (sinceDate) {
    args.push(`--since=${sinceDate}`);
  }
  return safeGitExecute(projectPath, args);
}

/**
 * 解析 git log --format=%ai 输出为日期 → 提交次数的 Map
 * 输入每行格式: "2026-07-10 14:23:01 +0800"
 * 只取日期部分 "YYYY-MM-DD"
 */
function parseGitDates(output: string): Map<string, number> {
  const map = new Map<string, number>();
  const trimmed = output.trim();
  if (!trimmed) return map;

  for (const line of trimmed.split('\n')) {
    const dateStr = line.slice(0, 10); // "YYYY-MM-DD"
    map.set(dateStr, (map.get(dateStr) ?? 0) + 1);
  }
  return map;
}

/** 从排序后的日期数组计算最长连续和当前连续天数 */
function computeStreaks(sortedDates: string[]): {
  longestStreak: number;
  currentStreak: number;
} {
  if (sortedDates.length === 0) {
    return { longestStreak: 0, currentStreak: 0 };
  }

  const dateSet = new Set(sortedDates);

  // 计算最长连续天数
  let longestStreak = 0;
  let currentRun = 0;
  let prevDate: Date | null = null;

  for (const dateStr of sortedDates) {
    const d = new Date(dateStr + 'T00:00:00');
    if (prevDate) {
      const diffDays = Math.round((d.getTime() - prevDate.getTime()) / 86400000);
      if (diffDays === 1) {
        currentRun++;
      } else {
        currentRun = 1;
      }
    } else {
      currentRun = 1;
    }
    longestStreak = Math.max(longestStreak, currentRun);
    prevDate = d;
  }

  // 计算当前连续天数（从今天往回数）
  let currentStreak = 0;
  const today = new Date();
  for (let i = 0; ; i++) {
    const checkDate = new Date(today);
    checkDate.setDate(today.getDate() - i);
    const checkStr = checkDate.toISOString().slice(0, 10);
    if (dateSet.has(checkStr)) {
      currentStreak++;
    } else {
      break;
    }
  }

  return { longestStreak, currentStreak };
}

/** 执行 git shortlog 获取贡献者及提交数 */
async function runGitShortlog(
  projectPath: string,
  sinceDate: string | null,
): Promise<string> {
  const args = ['shortlog', '-sn', '--all'];
  if (sinceDate) {
    args.push(`--since=${sinceDate}`);
  }
  return safeGitExecute(projectPath, args);
}

/** 解析 shortlog 输出: "     5  Author Name\n     3  Other Author" */
function parseShortlog(output: string): Array<{ name: string; count: number }> {
  const trimmed = output.trim();
  if (!trimmed) return [];

  return trimmed.split('\n').map((line) => {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (match) {
      return { count: parseInt(match[1]!, 10), name: match[2]! };
    }
    return { count: 0, name: line.trim() };
  });
}

/** 执行 git for-each-ref 获取本地分支列表 */
async function runGitBranchCount(projectPath: string): Promise<string> {
  return safeGitExecute(projectPath, [
    'for-each-ref',
    'refs/heads/',
    '--format=%(refname:short)',
  ]);
}

/** 执行 git log --shortstat 获取所有提交的增删统计 */
async function runGitShortstat(
  projectPath: string,
  sinceDate: string | null,
): Promise<string> {
  const args = ['log', '--all', '--shortstat'];
  if (sinceDate) {
    args.push(`--since=${sinceDate}`);
  }
  return safeGitExecute(projectPath, args);
}

/** 解析 --shortstat 输出，汇总所有 insertions 和 deletions */
function parseShortstat(output: string): { addLines: number; delLines: number } {
  let addLines = 0;
  let delLines = 0;

  for (const line of output.split('\n')) {
    const insMatch = line.match(/(\d+)\s+insertions?\(\+\)/);
    const delMatch = line.match(/(\d+)\s+deletions?\(\-\)/);

    if (insMatch) {
      addLines += parseInt(insMatch[1]!, 10);
    }
    if (delMatch) {
      delLines += parseInt(delMatch[1]!, 10);
    }
  }

  return { addLines, delLines };
}

/** 获取项目统计数据 */
export async function getProjectStats(
  projectPath: string,
  range: StatsRange,
): Promise<ProjectStats> {
  const sinceDate = getSinceDate(range);

  // 并行执行 git 命令
  const [dateOutput, shortlogOutput, branchOutput, shortstatOutput] = await Promise.all([
    runGitLog(projectPath, sinceDate),
    runGitShortlog(projectPath, sinceDate),
    runGitBranchCount(projectPath),
    runGitShortstat(projectPath, sinceDate),
  ]);

  const heatmap = parseGitDates(dateOutput);
  const dailyCounts = Array.from(heatmap.values());
  const totalCommits = dailyCounts.reduce((sum, c) => sum + c, 0);

  // 计算日期相关指标
  const dates = Array.from(heatmap.keys()).sort();
  const { longestStreak, currentStreak } = computeStreaks(dates);

  // 最活跃日
  let mostActiveDate = '-';
  let maxCount = 0;
  for (const [date, count] of heatmap) {
    if (count > maxCount) {
      maxCount = count;
      mostActiveDate = date;
    }
  }

  // 解析贡献者
  const contributors = parseShortlog(shortlogOutput);

  // 分支数
  const branchCount = branchOutput.trim() ? branchOutput.trim().split('\n').length : 0;

  // 增删行数
  const { addLines, delLines } = parseShortstat(shortstatOutput);

  return {
    totalCommits,
    activeDays: dates.length,
    longestStreak,
    currentStreak,
    mostActiveDate,
    contributors,
    addLines,
    delLines,
    branchCount,
    heatmap,
  };
}
