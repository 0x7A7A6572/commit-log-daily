import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { recordTaskPreference } from '../../config/prefs.js';
import { AgentToolError } from '../../shared/errors.js';

/**
 * 更新用户偏好统计
 * LLM 在 collect 阶段末尾调用，将本次任务的行为快照写入 prefs.json
 * 仅 collect 阶段可用
 */
export const updatePreferenceTool = tool(
  async ({ projects, timeRange, timeRangeDays, hasExtraWork }) => {
    // 至少需要一个维度才有记录意义
    if (!projects || projects.length === 0) {
      return '未提供项目信息，跳过偏好记录。';
    }

    try {
      recordTaskPreference({
        projects,
        timeRangeType: timeRange ?? 'custom',
        timeRangeDays: timeRangeDays ?? 0,
        hasExtraWork: hasExtraWork ?? false,
      });
    } catch (err) {
      throw new AgentToolError(
        `记录偏好失败: ${err instanceof Error ? err.message : String(err)}`,
        'updatePreference',
      );
    }

    return `偏好已记录：${projects.join(', ')} · ${timeRange ?? '未知范围'} · ${timeRangeDays ?? '?'}天 · ${hasExtraWork ? '有' : '无'}额外工作`;
  },
  {
    name: 'updatePreference',
    description:
      '记录本次任务的完整偏好快照，供下次新会话快速启动。' +
      '在 collect 阶段结束前调用。所有参数必须基于对话中已确认的信息，不得猜测。',
    schema: z.object({
      projects: z.array(z.string()).describe(
        '本次任务涉及的项目名称列表，仅包含已在对话中确认使用的项目',
      ),
      timeRange: z.enum(['daily', 'weekly', 'monthly', 'custom']).describe(
        '时间范围类型，基于用户明确指定或已确认的日期范围推断',
      ),
      timeRangeDays: z.number().describe(
        '时间范围的实际天数（since 到 until 的差值 + 1）。dialog 无法确认时传 0',
      ),
      hasExtraWork: z.boolean().describe(
        '用户是否在步骤 5 补充了额外工作内容。true=有补充，false=明确表示没有',
      ),
    }),
  },
);
