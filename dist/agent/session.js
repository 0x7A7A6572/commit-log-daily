import { createEmptyContext, PHASE_TRANSITION_MARKER } from './types.js';
/**
 * 检查是否可以切换到 generate 阶段
 * 三个必要条件：日期范围 + 至少一个项目 + 至少一条 commit
 */
export function canTransitionToGenerate(ctx) {
    const hasDateRange = ctx.dateRange !== null;
    const hasProjects = ctx.projects.length > 0;
    const hasCommits = ctx.commits.length > 0;
    return hasDateRange && hasProjects && hasCommits;
}
/**
 * 处理 Agent 的响应，检测阶段切换信号
 * 返回是否应该切换到 generate 阶段
 */
export function evaluatePhaseTransition(currentPhase, content, context) {
    if (currentPhase !== 'collect')
        return currentPhase;
    const hasMarker = content.includes(PHASE_TRANSITION_MARKER);
    const canTransition = canTransitionToGenerate(context);
    if (hasMarker && canTransition) {
        return 'generate';
    }
    if (hasMarker && !canTransition) {
        // 有标记但条件不满足 — Agent 过早发了信号，保持在 collect
        return 'collect';
    }
    return currentPhase;
}
/**
 * 从外部传入的更新合并到 SessionContext
 */
export function applyContextUpdates(context, updates) {
    return {
        dateRange: updates.dateRange ?? context.dateRange,
        projects: updates.projects ?? context.projects,
        commits: updates.commits ?? context.commits,
        userSupplements: updates.userSupplements ?? context.userSupplements,
    };
}
export { createEmptyContext };
//# sourceMappingURL=session.js.map