import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { getProjectStats } from '../shared/project-stats.js';
import type { ProjectStats } from '../shared/project-stats.js';

/** 热力图密度字符，从浅到深（仅着色层级，· 作为空单元格背景单独处理） */
const DENSITY_CHARS = ['░', '▒', '▓', '█'] as const;

/** 月份名称缩写 */
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** 一天的毫秒数 */
const MS_PER_DAY = 86400000;

/** 星期标签（周一/周三/周五标注） */
const DAY_LABELS: Record<number, string> = {
  1: 'Mon',
  3: 'Wed',
  5: 'Fri',
};

interface ProjectDetailViewProps {
  projectName: string;
  projectPath: string;
  onBack: () => void;
}

/**
 * 项目详情视图
 * 展示热力图和统计指标
 */
export function ProjectDetailView({
  projectName,
  projectPath,
  onBack,
}: ProjectDetailViewProps) {
  const [stats, setStats] = useState<ProjectStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setStats(null);

    getProjectStats(projectPath, '1year')
      .then((result) => {
        if (!cancelled) {
          setStats(result);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  useInput((_input, key) => {
    if (key.escape) {
      onBack();
    }
  });

  return (
    <Box flexDirection="column" minHeight={24} paddingLeft={1} paddingRight={1}>
      {/* 标题栏 */}
      <Box flexDirection="column" backgroundColor="white" marginBottom={1}>
        <Text bold color="black">
          {'·'} commit-log-daily {'·'} 项目详情 — {projectName}
        </Text>
      </Box>

      {/* 异常状态 */}
      {error && (
        <Box marginTop={1}>
          <Text color="red">无法访问仓库: {error}</Text>
        </Box>
      )}
      {loading && (
        <Box marginTop={1}>
          <Text dimColor>计算中...</Text>
        </Box>
      )}

      {/* 正常数据 */}
      {stats && !loading && !error && (
        <>
          {stats.totalCommits === 0 ? (
            <Box marginTop={1}>
              <Text dimColor>该项目尚无提交记录</Text>
            </Box>
          ) : (
            <HeatmapGrid stats={stats} />
          )}
          {/** 指标 */}
          <HeatmapLegend />

          {/* 统计指标（即使 totalCommits === 0 也显示，因为 activeDays 等仍有意义） */}
          <StatsPanel stats={stats} />
        </>
      )}

      {/* 底部操作提示 */}
      <Box marginTop={1}>
        <Text dimColor>Esc 返回项目列表</Text>
      </Box>
    </Box>
  );
}

// ============================================================
// 热力图组件
// ============================================================

/** 计算五分位阈值（20%/40%/60%/80%） */
function computeQuartiles(counts: number[]): [number, number, number, number] {
  const nonZero = counts.filter((c) => c > 0).sort((a, b) => a - b);
  if (nonZero.length === 0) return [1, 1, 1, 1];

  const q1 = nonZero[Math.floor(nonZero.length * 0.2)]!;
  const q2 = nonZero[Math.floor(nonZero.length * 0.4)]!;
  const q3 = nonZero[Math.floor(nonZero.length * 0.6)]!;
  const q4 = nonZero[Math.floor(nonZero.length * 0.8)]!;
  return [q1, q2, q3, q4];
}

/** 根据提交次数和分位阈值返回密度字符，无数据返回 · */
function densityChar(count: number, thresholds: [number, number, number, number]): string {
  if (count === 0) return '·';
  if (count <= thresholds[0]) return DENSITY_CHARS[0]!;
  if (count <= thresholds[1]) return DENSITY_CHARS[1]!;
  if (count <= thresholds[2]) return DENSITY_CHARS[2]!;
  return DENSITY_CHARS[3]!;
}

/** 判断密度字符是否需要着色（仅 · 不着色，░▒▓█ 着色） */
function isColoredChar(char: string): boolean {
  return char !== '·';
}

/**
 * 将 Date 对象格式化为本地日期字符串 "YYYY-MM-DD"
 * 注意：不能使用 toISOString()，因为 git %ai 输出的是本地时间，
 * 而 toISOString() 返回 UTC，在跨时区场景下会导致日期不匹配。
 */
function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface HeatmapGridProps {
  stats: ProjectStats;
}

/** 提交热力图 */
function HeatmapGrid({ stats }: HeatmapGridProps) {
  const counts = Array.from(stats.heatmap.values());
  const thresholds = computeQuartiles(counts);

  return <WeekGridHeatmap stats={stats} thresholds={thresholds} />;
}

// ============================================================
// 周网格热力图
// ============================================================

/** GitHub 风格 7 行 × N 列周网格热力图，仅 ░▒▓█ 着色 */
function WeekGridHeatmap({
  stats,
  thresholds,
}: {
  stats: ProjectStats;
  thresholds: [number, number, number, number];
}) {
  // 确定日期范围
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 使用最早提交日期作为起点，至少回溯一年
  const dates = Array.from(stats.heatmap.keys()).sort();
  const earliestDate = dates.length > 0 ? new Date(dates[0]! + 'T00:00:00') : new Date(today);
  const oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(today.getFullYear() - 1);
  const rangeStart = earliestDate < oneYearAgo ? earliestDate : oneYearAgo;

  // 网格边界对齐到周一和周日
  const gridStart = new Date(rangeStart);
  const startDay = gridStart.getDay(); // 0=Sun
  const daysFromMonday = startDay === 0 ? 6 : startDay - 1;
  gridStart.setDate(gridStart.getDate() - daysFromMonday);

  const gridEnd = new Date(today);
  const endDay = gridEnd.getDay();
  const daysToSunday = endDay === 0 ? 0 : 7 - endDay;
  gridEnd.setDate(gridEnd.getDate() + daysToSunday);

  // 总周数
  const totalDays = Math.round((gridEnd.getTime() - gridStart.getTime()) / MS_PER_DAY);
  const totalWeeks = Math.ceil(totalDays / 7);

  // 构建 7 行 × totalWeeks 列的二维字符网格
  // grid[0]=Mon, grid[1]=Tue, ..., grid[6]=Sun
  const grid: string[][] = Array.from({ length: 7 }, () => []);

  // 月份标签
  const monthLabels: Array<{ col: number; label: string }> = [];
  let lastMonth = -1;

  for (let col = 0; col < totalWeeks; col++) {
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
      const cellDate = new Date(gridStart);
      cellDate.setDate(gridStart.getDate() + col * 7 + dayOfWeek);
      const dateKey = toLocalDateKey(cellDate);
      const count = stats.heatmap.get(dateKey) ?? 0;
      const char = densityChar(count, thresholds);
      grid[dayOfWeek]!.push(char);

      // 记录月份标签（每月第一周的第一个格子时记录）
      const month = cellDate.getMonth();
      if (dayOfWeek === 0 && (lastMonth === -1 || month !== lastMonth)) {
        monthLabels.push({ col, label: MONTH_NAMES[month]! });
        lastMonth = month;
      }
    }
  }

  // 渲染月份标签行
  const monthLine = buildMonthLabelLine(monthLabels, totalWeeks);

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* 月份标签行 */}
      <Text>      {monthLine}</Text>

      {/* 7 行热力图：每个格子独立 Text，仅 ░▒▓█ 着色 */}
      {grid.map((rowCells, dayIdx) => {
        const label = DAY_LABELS[dayIdx + 1]; // dayIdx 0=Mon, 1=Tue, ...
        const labelStr = label ? label.padStart(3) : '   ';
        return (
          <Box key={dayIdx}>
            <Text>{labelStr} </Text>
            {rowCells.map((char, colIdx) => (
              <Text key={colIdx} color={isColoredChar(char) ? 'blue' : undefined}>
                {char}
              </Text>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}

// ============================================================
// 共享图例
// ============================================================

/** 热力图图例 */
function HeatmapLegend() {
  return (
    <Box marginTop={1}>
      <Box>
        <Text>{'      Less '}</Text>
        <Text color="blue">
          {DENSITY_CHARS[0]} {DENSITY_CHARS[1]} {DENSITY_CHARS[2]} {DENSITY_CHARS[3]}
        </Text>
        <Text>{' More'}</Text>
      </Box>
      <Box marginLeft={2}><Text>  ·  1 year ago</Text></Box>
    </Box>
  );
}

/** 根据月份标注位置构建月份标签行 */
function buildMonthLabelLine(
  monthLabels: Array<{ col: number; label: string }>,
  totalWeeks: number,
): string {
  if (monthLabels.length === 0) return '';

  // 构建字符数组，初始全空格
  const chars: string[] = Array.from({ length: totalWeeks }, () => ' ');

  for (let i = 0; i < monthLabels.length; i++) {
    const { col, label } = monthLabels[i]!;
    const nextCol = i + 1 < monthLabels.length ? monthLabels[i + 1]!.col : totalWeeks;
    const span = nextCol - col;

    // 计算标签放置的起始位置（居中）
    const labelStart = col + Math.max(0, Math.floor((span - label.length) / 2));

    for (let j = 0; j < label.length; j++) {
      const pos = labelStart + j;
      if (pos < totalWeeks) {
        chars[pos] = label[j]!;
      }
    }
  }

  return chars.join('');
}

// ============================================================
// 统计指标面板组件
// ============================================================

/** 格式化日期 "YYYY-MM-DD" -> "Mmm D" 如 "Jul 5" */
function formatShortDate(dateStr: string): string {
  if (dateStr === '-') return '-';
  const d = new Date(dateStr + 'T00:00:00');
  const month = MONTH_NAMES[d.getMonth()]!;
  return `${month} ${d.getDate()}`;
}

/** 格式化数字，加千分位 */
function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

interface StatsPanelProps {
  stats: ProjectStats;
}

/** 两列布局左列宽度 */
const LEFT_COL_WIDTH = 28;

/** 统计指标面板 — 两列布局，数值高亮 */
function StatsPanel({ stats }: StatsPanelProps) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Box width={LEFT_COL_WIDTH}>
          <Text>
            总提交: <Text color="cyan">{formatNumber(stats.totalCommits)}</Text>
          </Text>
        </Box>
        <Text>
          活跃天数: <Text color="cyan">{stats.activeDays}</Text>
        </Text>
      </Box>
      <Box>
        <Box width={LEFT_COL_WIDTH}>
          <Text>
            最长连续: <Text color="cyan">{stats.longestStreak}</Text> 天
          </Text>
        </Box>
        <Text>
          当前连续: <Text color="cyan">{stats.currentStreak}</Text> 天
        </Text>
      </Box>
      <Box>
        <Box width={LEFT_COL_WIDTH}>
          <Text>
            代码: +<Text color="green">{formatNumber(stats.addLines)}</Text>  -<Text color="red">{formatNumber(stats.delLines)}</Text>
          </Text>
        </Box>
        <Text>
          贡献者: <Text color="cyan">{stats.contributors.length}</Text> 人
        </Text>
      </Box>
      <Box>
        <Box width={LEFT_COL_WIDTH}>
          <Text>
            分支数: <Text color="cyan">{stats.branchCount}</Text>
          </Text>
        </Box>
        <Text>
          最活跃日: <Text color="cyan">{formatShortDate(stats.mostActiveDate)}</Text>
        </Text>
      </Box>
    </Box>
  );
}
