/** Git 提交记录的格式化输出 */
export interface GitLogEntry {
  hash: string;
  author: string;
  date: string;
  message: string;
  branch: string;
}

/** 扫描 Git 后返回的结构化结果 */
export interface GitScanResult {
  projectName: string;
  projectPath: string;
  commitCount: number;
  commits: GitLogEntry[];
}

/** 会话上下文，TUI 层和 Agent 层共享 */
export interface SessionContext {
  dateRange: { since: string; until: string } | null;
  projects: { name: string; path: string }[];
  commits: GitScanResult[];
  userSupplements: string[];
}

/** Agent 工作阶段 */
export type AgentPhase = 'collect' | 'generate';

/** Agent 阶段切换信号标记 */
export const PHASE_TRANSITION_MARKER = '[PHASE:generate]';

/** 创建空的会话上下文 */
export function createEmptyContext(): SessionContext {
  return {
    dateRange: null,
    projects: [],
    commits: [],
    userSupplements: [],
  };
}
