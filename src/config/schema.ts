import { z } from 'zod';

/** 大模型配置 schema */
const modelSchema = z.object({
  baseUrl: z.string().url('Base URL 必须是合法的 URL').or(z.literal('')),
  model: z.string(),
  apiKey: z.string(),
});

/** Git 作者配置 schema */
const authorSchema = z.object({
  name: z.string(),
  email: z.string().email('邮箱格式不正确').or(z.literal('')),
});

/** 单个项目配置 schema */
const projectSchema = z.object({
  name: z.string().min(1, '项目名不能为空'),
  path: z.string().min(1, '项目路径不能为空'),
});

/** 报告配置 schema */
const reportSchema = z.object({
  outputDir: z.string(),
  template: z.string().default('default'),
});

/** 安全配置 schema */
const safetySchema = z.object({
  /** 安全模式：开启时仅允许白名单 Git 子命令和系统命令，关闭时允许所有命令 */
  safeMode: z.boolean().default(true),
});

/** 应用完整配置 schema */
export const appConfigSchema = z.object({
  model: modelSchema,
  author: authorSchema,
  projects: z.array(projectSchema),
  report: reportSchema,
  /** 安全配置 — 旧版配置文件可能没有此字段，缺失时默认开启安全模式 */
  safety: safetySchema.default({ safeMode: true }),
});

/** 配置类型导出 */
export type AppConfig = z.infer<typeof appConfigSchema>;

/** 项目配置类型 */
export type ProjectConfig = z.infer<typeof projectSchema>;

/** 模型配置类型 */
export type ModelConfig = z.infer<typeof modelSchema>;

/** 作者配置类型 */
export type AuthorConfig = z.infer<typeof authorSchema>;

/** 报告配置类型 */
export type ReportConfig = z.infer<typeof reportSchema>;

/** 安全配置类型 */
export type SafetyConfig = z.infer<typeof safetySchema>;

/** 应用默认配置 */
export const DEFAULT_CONFIG: AppConfig = {
  model: {
    baseUrl: 'https://api.openai.com/v1',
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
    template: 'default',
  },
  safety: {
    safeMode: true,
  },
};

/** 环境变量到配置键的映射（仅模型配置支持环境变量覆盖） */
export const ENV_OVERRIDES: Array<{
  envKey: string;
  configPath: string;
}> = [
  { envKey: 'AI_API_KEY', configPath: 'model.apiKey' },
  { envKey: 'AI_BASE_URL', configPath: 'model.baseUrl' },
  { envKey: 'AI_MODEL', configPath: 'model.model' },
];
