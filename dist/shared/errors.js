/**
 * 自定义错误类型
 * 每种错误携带相关上下文，便于定位问题
 */
/** Git 执行失败 */
export class GitExecutionError extends Error {
    projectPath;
    gitArgs;
    constructor(message, projectPath, gitArgs) {
        const argsSummary = gitArgs.join(' ');
        super(`Git 执行失败 [${projectPath}] ${argsSummary}: ${message}`);
        this.projectPath = projectPath;
        this.gitArgs = gitArgs;
        this.name = 'GitExecutionError';
    }
}
/** 配置校验失败 */
export class ConfigValidationError extends Error {
    fieldPath;
    constructor(message, fieldPath) {
        super(`配置校验失败 [${fieldPath}]: ${message}`);
        this.fieldPath = fieldPath;
        this.name = 'ConfigValidationError';
    }
}
/** Agent 工具执行失败 */
export class AgentToolError extends Error {
    toolName;
    cause;
    constructor(message, toolName, cause) {
        super(`工具 ${toolName} 执行失败: ${message}`);
        this.toolName = toolName;
        this.cause = cause;
        this.name = 'AgentToolError';
        if (cause) {
            this.stack = cause.stack;
        }
    }
}
//# sourceMappingURL=errors.js.map