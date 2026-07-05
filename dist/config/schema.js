import { z } from 'zod';
/** 大模型配置 schema */
const modelSchema = z.object({
    baseUrl: z.string().url('Base URL 必须是合法的 URL'),
    model: z.string().min(1, '模型名不能为空'),
    apiKey: z.string().min(1, 'API Key 不能为空'),
});
/** Git 作者配置 schema */
const authorSchema = z.object({
    name: z.string().min(1, '作者名不能为空'),
    email: z.string().email('邮箱格式不正确'),
});
/** 单个项目配置 schema */
const projectSchema = z.object({
    name: z.string().min(1, '项目名不能为空'),
    path: z.string().min(1, '项目路径不能为空'),
});
/** 报告配置 schema */
const reportSchema = z.object({
    outputDir: z.string(),
});
/** 应用完整配置 schema */
export const appConfigSchema = z.object({
    model: modelSchema,
    author: authorSchema,
    projects: z.array(projectSchema),
    report: reportSchema,
});
/** 应用默认配置 */
export const DEFAULT_CONFIG = {
    model: {
        baseUrl: 'https://api.openai.com',
        model: 'gpt-4.1-mini',
        apiKey: '',
    },
    author: {
        name: '',
        email: '',
    },
    projects: [],
    report: {
        outputDir: '',
    },
};
/** 环境变量到配置键的映射（仅模型配置支持环境变量覆盖） */
export const ENV_OVERRIDES = [
    { envKey: 'AI_API_KEY', configPath: 'model.apiKey' },
    { envKey: 'AI_BASE_URL', configPath: 'model.baseUrl' },
    { envKey: 'AI_MODEL', configPath: 'model.model' },
];
//# sourceMappingURL=schema.js.map