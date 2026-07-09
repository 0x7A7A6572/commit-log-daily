import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { getProjectStats } from '../shared/project-stats.js';
import type { ProjectStats, StatsRange } from '../shared/project-stats.js';

/** 时间范围顺序 */
const RANGE_ORDER: StatsRange[] = ['all', '7days', '30days'];

/** 时间范围标签 */
const RANGE_LABEL: Record<StatsRange, string> = {
  all: 'All time',
  '7days': 'Last 7 days',
  '30days': 'Last 30 days',
};

/** 热力图密度字符，从浅到深 */
const DENSITY_CHARS = ['·', '░', '▒', '▓', '█'] as const;

/** 月份名称缩写 */
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

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
 * 展示热力图和统计指标，支持左/右键切换时间范围
 */
export function ProjectDetailView({
  projectName,
  projectPath,
  onBack,
}: ProjectDetailViewProps) {
  const [range, setRange] = useState<StatsRange>('all');
  const [stats, setStats] = useState<ProjectStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getProjectStats(projectPath, range)
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
  }, [projectPath, range]);

  useInput((_input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.leftArrow) {
      setRange((prev) => {
        const idx = RANGE_ORDER.indexOf(prev);
        return RANGE_ORDER[(idx - 1 + RANGE_ORDER.length) % RANGE_ORDER.length]!;
      });
      return;
    }
    if (key.rightArrow) {
      setRange((prev) => {
        const idx = RANGE_ORDER.indexOf(prev);
        return RANGE_ORDER[(idx + 1) % RANGE_ORDER.length]!;
      });
      return;
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
      {stats && !loading && (
        <>
          {stats.totalCommits === 0 ? (
            <Box marginTop={1}>
              <Text dimColor>该项目尚无提交记录</Text>
            </Box>
          ) : (
            <>
              {/* 热力图 */}
              <HeatmapGrid stats={stats} range={range} />

              {/* 时间范围切换器 */}
              <Box marginTop={1}>
                {RANGE_ORDER.map((r) => {
                  const isActive = r === range;
                  const label = RANGE_LABEL[r];
                  return (
                    <Text key={r} color={isActive ? 'cyan' : undefined} dimColor={!isActive}>
                      {label}
                      {r !== RANGE_ORDER[RANGE_ORDER.length - 1] ? ' · ' : ''}
                    </Text>
                  );
                })}
              </Box>
            </>
          )}

          {/* 统计指标（即使 totalCommits === 0 也显示，因为 activeDays 等仍有意义） */}
          <StatsPanel stats={stats} />
        </>
      )}

      {/* 底部操作提示 */}
      <Box marginTop={1}>
        <Text dimColor>{'← →'} 切换时间范围   Esc 返回项目列表</Text>
      </Box>
    </Box>
  );
}

// ============================================================
// 热力图组件
// ============================================================

/** 计算四分位数阈值 */
function computeQuartiles(counts: number[]): [number, number, number] {
  const nonZero = counts.filter((c) => c > 0).sort((a, b) => a - b);
  if (nonZero.length === 0) return [1, 1, 1];

  const q1 = nonZero[Math.floor(nonZero.length * 0.25)]!;
  const q2 = nonZero[Math.floor(nonZero.length * 0.50)]!;
  const q3 = nonZero[Math.floor(nonZero.length * 0.75)]!;
  return [q1, q2, q3];
}

/** 根据提交次数和四分位阈值返回密度字符 */
function densityChar(count: number, thresholds: [number, number, number]): string {
  if (count === 0) return DENSITY_CHARS[0]!;
  if (count <= thresholds[0]) return DENSITY_CHARS[1]!;
  if (count <= thresholds[1]) return DENSITY_CHARS[2]!;
  if (count <= thresholds[2]) return DENSITY_CHARS[3]!;
  return DENSITY_CHARS[4]!;
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
  range: StatsRange;
}

/** 提交热力图 — GitHub 风格 7 行 x N 列网格 */
function HeatmapGrid({ stats, range }: HeatmapGridProps) {
  const counts = Array.from(stats.heatmap.values());
  const thresholds = computeQuartiles(counts);

  // 确定日期范围
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let rangeStart: Date;
  if (range === 'all') {
    // All time: 使用最早提交日期作为起点，至少回溯一年
    const dates = Array.from(stats.heatmap.keys()).sort();
    const earliestDate = dates.length > 0 ? new Date(dates[0]! + 'T00:00:00') : new Date(today);
    const oneYearAgo = new Date(today);
    oneYearAgo.setFullYear(today.getFullYear() - 1);
    rangeStart = earliestDate < oneYearAgo ? earliestDate : oneYearAgo;
  } else if (range === '7days') {
    rangeStart = new Date(today);
    rangeStart.setDate(today.getDate() - 7);
  } else {
    rangeStart = new Date(today);
    rangeStart.setDate(today.getDate() - 30);
  }

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
  const totalDays = Math.round((gridEnd.getTime() - gridStart.getTime()) / 86400000);
  const totalWeeks = Math.ceil(totalDays / 7);

  // 构建 7 行 x totalWeeks 列的字符网格
  // rows[0]=Mon, rows[1]=Tue, ..., rows[6]=Sun
  const rows: string[] = Array.from({ length: 7 }, () => '');

  // 月份标签
  const monthLabels: Array<{ col: number; label: string }> = [];
  let lastMonth = -1;

  for (let col = 0; col < totalWeeks; col++) {
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
      const cellDate = new Date(gridStart);
      cellDate.setDate(gridStart.getDate() + col * 7 + dayOfWeek);
      // 使用本地日期格式化，与 heatmap Map 的键一致（git %ai 是本地时间）
      const dateKey = toLocalDateKey(cellDate);
      const count = stats.heatmap.get(dateKey) ?? 0;
      const char = densityChar(count, thresholds);
      rows[dayOfWeek] += char;

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
      <Text color="blue">      {monthLine}</Text>

      {/* 7 行热力图 */}
      {rows.map((rowChars, dayIdx) => {
        const label = DAY_LABELS[dayIdx + 1]; // dayIdx 0=Mon, 1=Tue, ...
        const labelStr = label ? label.padStart(3) : '   ';
        return (
          <Text key={dayIdx} color="blue">
            {labelStr} {rowChars}
          </Text>
        );
      })}

      {/* 图例 */}
      <Box marginTop={1}>
        <Text color="blue">
          {'      Less '}
          {DENSITY_CHARS[1]} {DENSITY_CHARS[2]} {DENSITY_CHARS[3]} {DENSITY_CHARS[4]}
          {' More'}
        </Text>
      </Box>
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

/** 统计指标面板 */
function StatsPanel({ stats }: StatsPanelProps) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        总提交: {formatNumber(stats.totalCommits)}     活跃天数: {stats.activeDays}
      </Text>
      <Text>
        最长连续: {stats.longestStreak} 天     当前连续: {stats.currentStreak} 天
      </Text>
      <Text>
        代码: +{formatNumber(stats.addLines)}  -{formatNumber(stats.delLines)}     贡献者: {stats.contributors.length} 人
      </Text>
      <Text>
        分支数: {stats.branchCount}     最活跃日: {formatShortDate(stats.mostActiveDate)}
      </Text>
    </Box>
  );
}
