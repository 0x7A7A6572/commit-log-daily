/**
 * 自定义错误类型
 * 每种错误携带相关上下文，便于定位问题
 */

/** Git 执行失败 */
export class GitExecutionError extends Error {
  constructor(
    message: string,
    readonly projectPath: string,
    readonly gitArgs: string[],
  ) {
    const argsSummary = gitArgs.join(' ');
    super(`Git 执行失败 [${projectPath}] ${argsSummary}: ${message}`);
    this.name = 'GitExecutionError';
  }
}

/** 配置校验失败 */
export class ConfigValidationError extends Error {
  constructor(
    message: string,
    readonly fieldPath: string,
  ) {
    super(`配置校验失败 [${fieldPath}]: ${message}`);
    this.name = 'ConfigValidationError';
  }
}

/** Agent 工具执行失败 */
export class AgentToolError extends Error {
  constructor(
    message: string,
    readonly toolName: string,
    readonly cause?: Error,
  ) {
    super(`工具 ${toolName} 执行失败: ${message}`);
    this.name = 'AgentToolError';
    if (cause) {
      this.stack = cause.stack;
    }
  }
}
