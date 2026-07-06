import type { SessionContext } from './types.js';
import { createEmptyContext } from './types.js';

/**
 * 从外部传入的更新合并到 SessionContext
 */
export function applyContextUpdates(
  context: SessionContext,
  updates: Partial<SessionContext>,
): SessionContext {
  return {
    dateRange: updates.dateRange ?? context.dateRange,
    projects: updates.projects ?? context.projects,
    commits: updates.commits ?? context.commits,
    userSupplements: updates.userSupplements ?? context.userSupplements,
  };
}

export { createEmptyContext };
