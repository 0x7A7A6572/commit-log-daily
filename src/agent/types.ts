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
  tokenUsage: { input_tokens: number, output_tokens: number };
}

/** 摘要记忆 */ 
interface SummaryMemory {
  content: string;            // LLM 生成的摘要文本
  tokenCount: number;         // content 占多少 token（给 trimMessages 用）
  messageCount: number;       // 覆盖了多少条原始消息（便于判断是否值得保留）
  createdAt: number;          // 生成时间（ms）
}

/** Agent 工作阶段 */
export type AgentPhase = 'collect' | 'generate';

/** 创建空的会话上下文 */
export function createEmptyContext(): SessionContext {
  return {
    dateRange: null,
    projects: [],
    commits: [],
    userSupplements: [],
    tokenUsage: { input_tokens: 0, output_tokens: 0 },
  };
}


/** 命令安全等级 */
export enum SafetyLevel {
  /** 绝对禁止 */
  Blocked = 999,
  /** 危险 - 可能有副作用，需要用户确认 */
  Warn = 1,
  /** 安全 */
  Safe = 0
}