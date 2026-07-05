import { tool } from '@langchain/core/tools';
import { z } from 'zod';
/**
 * 报告生成工具
 *
 * 注意：这个工具不直接调用 LLM。
 * 它将上下文序列化后返回给 Agent，
 * Agent 的 System Prompt 在 generate 阶段会基于这些数据生成报告。
 * 这个工具的作用是让 LLM 明确知道"现在可以生成报告了"。
 */
export const generateReportTool = tool(async ({ contextSummary, templateHint }) => {
    // 返回上下文组装指令，让 LLM 基于已有对话生成报告
    return JSON.stringify({
        instruction: 'generate_report',
        contextSummary,
        templateHint,
        guidelines: [
            '将同一天、同一功能的多次提交合并为一条描述',
            '用业务语言而非代码流水账',
            '按模板章节归类：核心产出、问题修复、技术优化、其他工作、下一步计划',
            '融入用户补充的隐性工作',
            '生成完成后询问用户是否需要调整或导出',
        ],
    });
}, {
    name: 'generateReport',
    description: '基于收集到的 Git 数据和用户补充信息，生成结构化的日报/周报。调用此工具表示数据收集已完毕，进入报告生成阶段。',
    schema: z.object({
        contextSummary: z.string().describe('收集到的数据摘要，包括日期范围、项目、提交数量'),
        templateHint: z.string().describe('报告类型提示，如 "daily" 或 "weekly"'),
    }),
});
//# sourceMappingURL=generate.js.map