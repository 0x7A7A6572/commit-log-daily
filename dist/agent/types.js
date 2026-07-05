/** Agent 阶段切换信号标记 */
export const PHASE_TRANSITION_MARKER = '[PHASE:generate]';
/** 创建空的会话上下文 */
export function createEmptyContext() {
    return {
        dateRange: null,
        projects: [],
        commits: [],
        userSupplements: [],
    };
}
//# sourceMappingURL=types.js.map