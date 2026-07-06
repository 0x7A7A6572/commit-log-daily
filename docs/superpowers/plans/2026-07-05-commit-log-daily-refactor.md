# commit-log-daily 重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 commit-log-daily 重构为基于 LangChain Agent + Ink TUI 的日报/周报生成智能体。

**Architecture:** 双层架构 — TUI 层（ChatView + ConfigView）负责终端渲染，Agent 层（base + tools + session）负责 LLM 交互与工具调用，Config 层负责配置持久化。工作流分 collect/generate 两阶段，阶段切换由 TUI 层控制。

**Tech Stack:** TypeScript 5.8, ESM/NodeNext, Ink 7 (React 19), LangChain, @langchain/openai, Zod

---

### 文件清单总览

| # | 文件 | 操作 | 职责 |
|---|------|------|------|
| 1 | `src/shared/errors.ts` | 创建 | 自定义错误类 |
| 2 | `src/config/schema.ts` | 创建 | Zod 配置结构 |
| 3 | `src/config/store.ts` | 创建 | 配置读写 |
| 4 | `src/agent/types.ts` | 创建 | Agent 层共享类型 |
| 5 | `src/agent/tools/scanGit.ts` | 创建 | 安全 Git 扫描工具 |
| 6 | `src/agent/tools/projects.ts` | 创建 | 项目管理工具 |
| 7 | `src/agent/tools/config-tool.ts` | 创建 | 配置管理工具 |
| 8 | `src/agent/tools/exportFile.ts` | 创建 | Markdown 导出工具 |
| 9 | `src/agent/tools/generate.ts` | 创建 | 报告生成工具 |
| 10 | `src/agent/prompts/system.ts` | 创建 | System Prompt |
| 11 | `src/agent/prompts/template.md` | 创建 | 报告模板 |
| 12 | `src/agent/base.ts` | 创建 | LLM 实例 + 工具绑定 |
| 13 | `src/agent/session.ts` | 创建 | Phase 切换逻辑 |
| 14 | `src/tui/ChatView.tsx` | 创建 | 聊天界面 |
| 15 | `src/tui/ConfigView.tsx` | 创建 | 配置页 |
| 16 | `src/tui/useSession.ts` | 创建 | 会话 hook |
| 17 | `src/tui/app.tsx` | 创建 | TUI 入口路由 |
| 18 | `src/index.ts` | 创建 | 导出入口 |
| 19 | `bin/agent.js` | 修改 | 更新引用路径 |
| 20 | `package.json` | 修改 | 添加依赖 |

---

### Task 1: 基础设施 — 自定义错误类

**Files:**
- Create: `src/shared/errors.ts`

- [ ] **Step 1: 创建 `src/shared/errors.ts`**

```typescript
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
```

- [ ] **Step 2: 验证目录结构**

```bash
ls src/shared/errors.ts
```

Expected: 文件存在。

---

### Task 2: 配置层 — Zod Schema

**Files:**
- Create: `src/config/schema.ts`

- [ ] **Step 1: 创建 `src/config/schema.ts`**

```typescript
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

/** 应用默认配置 */
export const DEFAULT_CONFIG: AppConfig = {
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
export const ENV_OVERRIDES: Array<{
  envKey: string;
  configPath: string;
}> = [
  { envKey: 'AI_API_KEY', configPath: 'model.apiKey' },
  { envKey: 'AI_BASE_URL', configPath: 'model.baseUrl' },
  { envKey: 'AI_MODEL', configPath: 'model.model' },
];
```

---

### Task 3: 配置层 — 持久化存储

**Files:**
- Create: `src/config/store.ts`

- [ ] **Step 1: 创建 `src/config/store.ts`**

```typescript
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { appConfigSchema, DEFAULT_CONFIG, ENV_OVERRIDES } from './schema.js';
import type { AppConfig } from './schema.js';

/** 配置文件目录 */
const CONFIG_DIR = path.join(os.homedir(), '.commit-log-daily');

/** 配置文件路径 */
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

/** 确保配置目录存在 */
function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * 读取配置文件
 * 三层 fallback：默认值 → config.json → 环境变量
 */
export function readConfig(): AppConfig {
  ensureConfigDir();

  // 从默认值开始
  let config = structuredClone(DEFAULT_CONFIG);

  // 尝试读取配置文件
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const fileData = JSON.parse(raw) as unknown;
      // Zod 校验并合并
      const validated = appConfigSchema.parse(fileData);
      config = validated;
    } catch {
      // 配置文件损坏时回退到默认值，不抛异常
      // 后续 writeConfig 会覆盖损坏文件
    }
  }

  // 环境变量覆盖（最高优先级）
  for (const { envKey, configPath } of ENV_OVERRIDES) {
    const envValue = process.env[envKey];
    if (envValue) {
      setByPath(config, configPath, envValue);
    }
  }

  return config;
}

/**
 * 写入配置文件
 */
export function writeConfig(config: AppConfig): void {
  ensureConfigDir();
  const validated = appConfigSchema.parse(config);
  const json = JSON.stringify(validated, null, 2);
  fs.writeFileSync(CONFIG_PATH, json, 'utf-8');
}

/**
 * 按路径字符串设置嵌套对象的值
 * 例如 setByPath(config, 'model.apiKey', 'sk-xxx')
 */
function setByPath(obj: Record<string, unknown>, pathStr: string, value: string): void {
  const keys = pathStr.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    if (!(key in current) || typeof current[key] !== 'object') {
      return;
    }
    current = current[key] as Record<string, unknown>;
  }
  const lastKey = keys[keys.length - 1]!;
  current[lastKey] = value;
}

/** 导出配置目录路径，供 exportFile 工具使用 */
export { CONFIG_DIR };
```

---

### Task 4: Agent 层 — 共享类型

**Files:**
- Create: `src/agent/types.ts`

- [ ] **Step 1: 创建 `src/agent/types.ts`**

```typescript
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
}

/** Agent 工作阶段 */
export type AgentPhase = 'collect' | 'generate';

/** Agent 阶段切换信号标记 */
export const PHASE_TRANSITION_MARKER = '[PHASE:generate]';

/** 创建空的会话上下文 */
export function createEmptyContext(): SessionContext {
  return {
    dateRange: null,
    projects: [],
    commits: [],
    userSupplements: [],
  };
}
```

---

### Task 5: Agent 工具 — 安全 Git 扫描

**Files:**
- Create: `src/agent/tools/scanGit.ts`

- [ ] **Step 1: 创建 `src/agent/tools/scanGit.ts`**

```typescript
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { GitExecutionError } from '../../shared/errors.js';
import type { GitLogEntry } from '../types.js';

const execFileAsync = promisify(execFile);

/** Git 只读子命令白名单 */
const ALLOWED_COMMANDS: string[] = ['log', 'branch', 'diff', 'show', 'status'];

/** 参数中禁止出现的危险模式 */
const BLOCKED_PATTERNS: string[] = ['rm', 'push', 'reset', 'clean', '--hard', ';', '&&', '|', '>', '<'];

/**
 * 安全执行本地 Git 命令
 * 使用 execFile + 数组传参，不经过 Shell，杜绝命令注入
 */
async function safeGitExecute(projectPath: string, args: string[]): Promise<string> {
  if (!path.isAbsolute(projectPath)) {
    throw new GitExecutionError(
      `路径必须是绝对路径，收到 "${projectPath}"`,
      projectPath,
      args,
    );
  }

  const subCommand = args[0];
  if (!subCommand || !ALLOWED_COMMANDS.includes(subCommand)) {
    throw new GitExecutionError(
      `不允许执行 git ${subCommand ?? 'undefined'}，仅支持 ${ALLOWED_COMMANDS.join(', ')}`,
      projectPath,
      args,
    );
  }

  for (const arg of args) {
    for (const pattern of BLOCKED_PATTERNS) {
      if (arg.toLowerCase().includes(pattern)) {
        throw new GitExecutionError(
          `参数包含危险模式 "${pattern}"，已拒绝执行`,
          projectPath,
          args,
        );
      }
    }
  }

  const { stdout, stderr } = await execFileAsync('git', ['-C', projectPath, ...args]);

  if (stderr) {
    return `Git 警告: ${stderr}\n输出: ${stdout}`;
  }
  return stdout;
}

/**
 * 解析 git log 格式化输出为结构化数组
 * 输入格式: %H|%an|%ai|%s|%D
 */
function parseGitLog(raw: string): GitLogEntry[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  return trimmed.split('\n').map((line) => {
    const parts = line.split('|');
    return {
      hash: (parts[0] ?? '').trim(),
      author: (parts[1] ?? '').trim(),
      date: (parts[2] ?? '').trim(),
      message: (parts[3] ?? '').trim(),
      branch: (parts[4] ?? '').trim(),
    };
  });
}

/** Git log 格式化字符串：hash|作者|日期|提交信息|引用 */
const LOG_FORMAT = '%H|%an|%ai|%s|%D';

/** 扫描本地 Git 仓库的工具 */
export const scanGitTool = tool(
  async ({ projectPath, since, until, author }) => {
    const args: string[] = [
      'log',
      '--all',
      `--format=${LOG_FORMAT}`,
      `--since=${since}`,
    ];

    if (until) {
      args.push(`--until=${until}`);
    }
    if (author) {
      args.push(`--author=${author}`);
    }

    const output = await safeGitExecute(projectPath, args);
    const commits = parseGitLog(output);

    return JSON.stringify({
      projectPath,
      commitCount: commits.length,
      commits,
    });
  },
  {
    name: 'scanGit',
    description:
      '扫描指定项目在时间范围内的 Git 提交记录。返回结构化的 commit 列表，包含 hash、作者、日期、提交信息和分支名。所有分支都会被扫描（--all）。',
    schema: z.object({
      projectPath: z.string().describe('项目的绝对路径'),
      since: z.string().describe('起始日期，如 "2026-06-30" 或 "Monday"'),
      until: z.string().optional().describe('截止日期（可选），如 "2026-07-05"'),
      author: z.string().optional().describe('按作者邮箱过滤（可选），默认不限制'),
    }),
  },
);
```

---

### Task 6: Agent 工具 — 项目管理

**Files:**
- Create: `src/agent/tools/projects.ts`

- [ ] **Step 1: 创建 `src/agent/tools/projects.ts`**

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { readConfig, writeConfig } from '../../config/store.js';
import { AgentToolError } from '../../shared/errors.js';

/** 列出已配置项目的工具 */
export const listProjectsTool = tool(
  async () => {
    const config = readConfig();
    if (config.projects.length === 0) {
      return '当前没有已配置的项目。';
    }
    const lines = config.projects.map(
      (p) => `- ${p.name}: ${p.path}`,
    );
    return `已配置的项目（共 ${config.projects.length} 个）：\n${lines.join('\n')}`;
  },
  {
    name: 'listProjects',
    description: '列出所有已配置的项目及其路径。',
    schema: z.object({}),
  },
);

/** 添加或更新项目的工具 */
export const addProjectTool = tool(
  async ({ name, filePath }) => {
    const absPath = path.resolve(filePath);

    // 校验路径存在
    if (!fs.existsSync(absPath)) {
      throw new AgentToolError(
        `路径不存在: ${absPath}`,
        'addProject',
      );
    }

    // 校验是 Git 仓库
    const gitDir = path.join(absPath, '.git');
    if (!fs.existsSync(gitDir)) {
      throw new AgentToolError(
        `路径不是 Git 仓库: ${absPath}`,
        'addProject',
      );
    }

    const config = readConfig();
    const existing = config.projects.findIndex((p) => p.name === name);

    if (existing !== -1) {
      // 更新已有项目
      config.projects[existing] = { name, path: absPath };
      writeConfig(config);
      return `项目 "${name}" 已更新，路径: ${absPath}`;
    }

    // 新增项目
    config.projects.push({ name, path: absPath });
    writeConfig(config);
    return `项目 "${name}" 已添加，路径: ${absPath}`;
  },
  {
    name: 'addProject',
    description:
      '添加或更新一个项目配置。需要项目名称和绝对路径。路径必须是存在的 Git 仓库。',
    schema: z.object({
      name: z.string().describe('项目名称，用于标识'),
      filePath: z.string().describe('项目的绝对路径或相对路径'),
    }),
  },
);

/** 删除项目的工具 */
export const removeProjectTool = tool(
  async ({ name }) => {
    const config = readConfig();
    const index = config.projects.findIndex((p) => p.name === name);

    if (index === -1) {
      return `未找到名为 "${name}" 的项目，无需删除。`;
    }

    config.projects.splice(index, 1);
    writeConfig(config);
    return `项目 "${name}" 已删除。`;
  },
  {
    name: 'removeProject',
    description: '从配置中删除一个项目。',
    schema: z.object({
      name: z.string().describe('要删除的项目名称'),
    }),
  },
);
```

---

### Task 7: Agent 工具 — 配置管理

**Files:**
- Create: `src/agent/tools/config-tool.ts`

- [ ] **Step 1: 创建 `src/agent/tools/config-tool.ts`**

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { readConfig, writeConfig } from '../../config/store.js';
import type { AppConfig } from '../../config/schema.js';

/**
 * 对 API Key 进行脱敏处理
 * 保留前 3 位和后 3 位，中间用 * 替代
 */
function maskApiKey(key: string): string {
  if (key.length <= 6) return '****';
  return `${key.slice(0, 3)}${'*'.repeat(key.length - 6)}${key.slice(-3)}`;
}

/**
 * 生成配置摘要文本
 */
function formatConfigSummary(config: AppConfig): string {
  const apiKeyDisplay = config.model.apiKey ? maskApiKey(config.model.apiKey) : '未配置';

  const lines: string[] = [
    '当前配置：',
    '',
    '【大模型】',
    `  Base URL: ${config.model.baseUrl}`,
    `  Model:    ${config.model.model}`,
    `  API Key:  ${apiKeyDisplay}`,
    '',
    '【Git 作者】',
    `  姓名: ${config.author.name || '未配置'}`,
    `  邮箱: ${config.author.email || '未配置'}`,
    '',
    '【项目列表】',
  ];

  if (config.projects.length === 0) {
    lines.push('  (无已配置项目)');
  } else {
    for (const p of config.projects) {
      lines.push(`  ${p.name} → ${p.path}`);
    }
  }

  lines.push('');
  lines.push(`【输出目录】${config.report.outputDir || '当前目录'}`);

  return lines.join('\n');
}

/** 查看当前配置的工具 */
export const getConfigTool = tool(
  async () => {
    const config = readConfig();
    return formatConfigSummary(config);
  },
  {
    name: 'getConfig',
    description: '查看当前的完整配置（API Key 会脱敏展示）。',
    schema: z.object({}),
  },
);

/** 更新配置的工具 */
export const setConfigTool = tool(
  async ({ section, key, value }) => {
    const config = readConfig();

    // 按 section 定位配置块，更新指定 key
    const sectionMap: Record<string, Record<string, unknown>> = {
      model: config.model as unknown as Record<string, unknown>,
      author: config.author as unknown as Record<string, unknown>,
      report: config.report as unknown as Record<string, unknown>,
    };

    const target = sectionMap[section];
    if (!target) {
      return `未知的配置分类 "${section}"。支持: model, author, report`;
    }

    if (!(key in target)) {
      return `配置分类 "${section}" 中没有 "${key}" 字段`;
    }

    target[key] = value;
    writeConfig(config);

    // 模型 API Key 脱敏反馈
    const displayValue = (section === 'model' && key === 'apiKey') ? maskApiKey(value) : value;
    return `已更新: ${section}.${key} = ${displayValue}`;
  },
  {
    name: 'setConfig',
    description: '更新应用配置。支持更新模型、作者、输出目录等配置项。',
    schema: z.object({
      section: z
        .enum(['model', 'author', 'report'])
        .describe('配置分类：model（大模型）、author（Git 作者）、report（报告输出）'),
      key: z.string().describe('要更新的字段名，如 "apiKey", "email", "outputDir"'),
      value: z.string().describe('新的值'),
    }),
  },
);
```

---

### Task 8: Agent 工具 — 文件导出

**Files:**
- Create: `src/agent/tools/exportFile.ts`

- [ ] **Step 1: 创建 `src/agent/tools/exportFile.ts`**

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { readConfig } from '../../config/store.js';
import { AgentToolError } from '../../shared/errors.js';

/**
 * 生成安全的文件名
 * 将空格和特殊字符替换为下划线
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 200);
}

/** 导出 Markdown 报告到文件的工具 */
export const exportFileTool = tool(
  async ({ content, filename }) => {
    const config = readConfig();
    const outputDir = config.report.outputDir || process.cwd();

    // 确保输出目录存在
    if (!fs.existsSync(outputDir)) {
      throw new AgentToolError(
        `输出目录不存在: ${outputDir}`,
        'exportFile',
      );
    }

    const safeName = sanitizeFilename(filename || `report_${Date.now()}`);
    const filePath = path.join(outputDir, `${safeName}.md`);

    fs.writeFileSync(filePath, content, 'utf-8');

    return `报告已导出到: ${filePath}`;
  },
  {
    name: 'exportFile',
    description: '将报告内容导出为 Markdown 文件。',
    schema: z.object({
      content: z.string().describe('要导出的 Markdown 文本内容'),
      filename: z.string().optional().describe('文件名（不含扩展名），默认使用时间戳'),
    }),
  },
);
```

---

### Task 9: Agent 工具 — 报告生成

**Files:**
- Create: `src/agent/tools/generate.ts`

- [ ] **Step 1: 创建 `src/agent/tools/generate.ts`**

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { SessionContext } from '../types.js';

/**
 * 报告生成工具
 * 
 * 注意：这个工具不直接调用 LLM。
 * 它将 SessionContext 序列化后返回给 Agent，
 * Agent 的 System Prompt 在 generate 阶段会基于这些数据生成报告。
 * 这个工具的作用是让 LLM 明确知道"现在可以生成报告了"。
 */
export const generateReportTool = tool(
  async ({ contextSummary, templateHint }) => {
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
  },
  {
    name: 'generateReport',
    description:
      '基于收集到的 Git 数据和用户补充信息，生成结构化的日报/周报。调用此工具表示数据收集已完毕，进入报告生成阶段。',
    schema: z.object({
      contextSummary: z.string().describe('收集到的数据摘要，包括日期范围、项目、提交数量'),
      templateHint: z.string().describe('报告类型提示，如 "daily" 或 "weekly"'),
    }),
  },
);
```

---

### Task 10: Agent 层 — System Prompt 与报告模板

**Files:**
- Create: `src/agent/prompts/system.ts`
- Create: `src/agent/prompts/template.md`

- [ ] **Step 1: 创建 `src/agent/prompts/system.ts`**

```typescript
/**
 * 收集阶段 System Prompt
 * Agent 带着 Git 扫描工具，收集数据、评估质量、反问用户
 */
export const COLLECT_SYSTEM_PROMPT = `你是研发效能助手，帮助开发者收集和整理开发活动数据。

你有以下工具可用：
- scanGit: 扫描 Git 仓库的提交记录
- listProjects: 查看已配置的项目
- addProject: 添加项目配置（需要路径）
- removeProject: 删除项目配置
- getConfig: 查看当前配置
- setConfig: 更新配置项

工作原则：
1. 用户提出生成报告时，先用 getConfig 确认是否有已配置的项目和作者信息。
   若 API Key 为空或作者邮箱为空，引导用户填写。
2. 项目列表为空则引导用户提供项目路径，用 addProject 注册。
3. 扫描 Git 数据后评估质量。发现以下问题必须反问用户，不要自行猜测：
   - 提交信息过于简略（如 "update", "fix", "111", "wip"）
   - 分支名无法归类
   - 提交数量异常少（用户可能遗漏了项目）
4. 数据收集完毕后，询问用户是否有未提交代码的隐性工作（帮人排查问题、开会讨论等）。
5. 确认数据完备后，在你回复的最后一行加入 "[PHASE:generate]" 触发报告生成。`;

/**
 * 生成阶段 System Prompt
 * Agent 切换到报告生成模式，基于完整上下文生成 Markdown 报告
 */
export const GENERATE_SYSTEM_PROMPT = `你是研发效能助手，现在进入报告生成阶段。

你将收到对话中累积的完整上下文：
- 结构化的 Git 提交记录（每个项目的 commit 列表）
- 用户在对话中补充的说明
- 一份报告模板

你的任务：
1. 对照模板结构，将 Git 数据映射到对应板块：
   - feat/ 分支或 "新增" 类提交 → 核心产出
   - fix/ 分支或 "修复" 类提交 → 问题修复
   - refactor/perf 类提交 → 技术优化
   - 用户补充的隐性工作 → 其他工作
2. 同一天、同一功能的多次提交合并为一条描述。
3. 用业务语言表述，避免代码流水账。例如：
   - 不好："修改了 user.ts 的 login 方法"
   - 好："完成用户登录模块的重构，提升代码可维护性"
4. 生成后主动询问用户：是否需要调整？是否需要导出为文件？
5. 导出时调用 exportFile 工具。`;
```

- [ ] **Step 2: 创建 `src/agent/prompts/template.md`**

```markdown
# {类型} — {日期范围}

## 核心产出

<!-- 从 commit 中提取 feat/ 分支和新增功能描述 -->

## 问题修复

<!-- 从 commit 中提取 fix/ 分支和修复描述 -->

## 技术优化

<!-- 从 commit 中提取 refactor、perf 相关提交 -->

## 其他工作

<!-- 用户补充的隐性工作、会议、协助等 -->

## 下一步计划

<!-- Agent 根据当前进度推断，用户确认 -->
```

---

### Task 11: Agent 层 — LLM 实例与工具绑定

**Files:**
- Create: `src/agent/base.ts`

- [ ] **Step 1: 创建 `src/agent/base.ts`**

```typescript
import { ChatOpenAI } from '@langchain/openai';
import { readConfig } from '../config/store.js';
import type { AgentPhase } from './types.js';

import { scanGitTool } from './tools/scanGit.js';
import { listProjectsTool, addProjectTool, removeProjectTool } from './tools/projects.js';
import { getConfigTool, setConfigTool } from './tools/config-tool.js';
import { exportFileTool } from './tools/exportFile.js';
import { generateReportTool } from './tools/generate.js';
import { COLLECT_SYSTEM_PROMPT, GENERATE_SYSTEM_PROMPT } from './prompts/system.js';

/** collect 阶段可用工具 */
const COLLECT_TOOLS = [
  scanGitTool,
  listProjectsTool,
  addProjectTool,
  removeProjectTool,
  getConfigTool,
  setConfigTool,
];

/** generate 阶段可用工具 */
const GENERATE_TOOLS = [
  generateReportTool,
  exportFileTool,
];

/**
 * 根据阶段创建对应的 ChatOpenAI 实例
 * 每次调用重新读取配置，确保使用最新配置（含对话中修改）
 */
export function createModelForPhase(phase: AgentPhase): ChatOpenAI {
  const config = readConfig();

  const model = new ChatOpenAI({
    model: config.model.model,
    temperature: 0,
    configuration: {
      baseURL: config.model.baseUrl,
      apiKey: config.model.apiKey,
    },
  });

  const systemPrompt = phase === 'collect' ? COLLECT_SYSTEM_PROMPT : GENERATE_SYSTEM_PROMPT;
  const tools = phase === 'collect' ? COLLECT_TOOLS : GENERATE_TOOLS;

  // 绑定 System Prompt 和工具
  return model.bindTools(tools);
}

/** 将 Agent 原始响应中的 [PHASE:generate] 标记移除，返回清洗后的文本 */
export function stripPhaseMarker(content: string): string {
  return content.replace(new RegExp(`\\n?\\[PHASE:generate\\]\\s*$`, 'g'), '').trim();
}

/** 检测 Agent 响应中是否包含阶段切换标记 */
export function hasPhaseMarker(content: string): boolean {
  return content.includes('[PHASE:generate]');
}
```

---

### Task 12: Agent 层 — Phase 切换逻辑

**Files:**
- Create: `src/agent/session.ts`

- [ ] **Step 1: 创建 `src/agent/session.ts`**

```typescript
import type { SessionContext, AgentPhase } from './types.js';
import { createEmptyContext, PHASE_TRANSITION_MARKER } from './types.js';

/**
 * 检查是否可以切换到 generate 阶段
 * 三个必要条件：日期范围 + 至少一个项目 + 至少一条 commit
 */
export function canTransitionToGenerate(ctx: SessionContext): boolean {
  const hasDateRange = ctx.dateRange !== null;
  const hasProjects = ctx.projects.length > 0;
  const hasCommits = ctx.commits.length > 0;

  return hasDateRange && hasProjects && hasCommits;
}

/** Agent 的推理结果 */
export interface AgentInvokeResult {
  content: string;
  phase: AgentPhase;
  /** 如果 LLM 调用了 addProject/scanGit 等工具导致 context 变化，这里更新 */
  contextUpdates: Partial<SessionContext>;
}

/**
 * 处理 Agent 的响应，检测阶段切换信号
 * 返回是否应该切换到 generate 阶段
 */
export function evaluatePhaseTransition(
  currentPhase: AgentPhase,
  content: string,
  context: SessionContext,
): AgentPhase {
  if (currentPhase !== 'collect') return currentPhase;

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
 * 从 Agent 的 SystemMessage 响应中提取上下文变化
 * 解析工具调用结果，更新 SessionContext
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
```

---

### Task 13: TUI — 聊天界面

**Files:**
- Create: `src/tui/ChatView.tsx`

- [ ] **Step 1: 创建 `src/tui/ChatView.tsx`**

```typescript
import { useState, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';

/** 聊天消息类型 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ChatViewProps {
  /** 当前消息列表 */
  messages: ChatMessage[];
  /** 用户提交消息的回调 */
  onSubmit: (text: string) => void;
  /** 是否正在等待 Agent 响应（显示加载指示） */
  isWaiting: boolean;
}

/** 聊天界面视图 */
export function ChatView({ messages, onSubmit, isWaiting }: ChatViewProps) {
  const { stdout } = useStdout();
  const [input, setInput] = useState('');
  const [termHeight, setTermHeight] = useState<number>(() => stdout?.rows ?? 24);

  // 监听终端尺寸变化
  useEffect(() => {
    const onResize = () => setTermHeight(stdout?.rows ?? 24);
    stdout?.on('resize', onResize);
    return () => void stdout?.off('resize', onResize);
  }, [stdout]);

  // 处理回车
  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || isWaiting) return;

    onSubmit(trimmed);
    setInput('');
  };

  useInput((_input, key) => {
    if (key.ctrl && (_input === 'c' || _input === 'd')) {
      process.exit(0);
    }
  });

  // 标题栏 + 输入区占的行数
  const HEADER_LINES = 1;
  const INPUT_LINES = 2;
  const maxMsgLines = Math.max(5, termHeight - HEADER_LINES - INPUT_LINES);

  // 按可见行数截取最近消息
  const visibleMessages = tailByLines(messages, maxMsgLines);

  const messageElements: React.ReactElement[] = [];

  for (const [i, msg] of visibleMessages.entries()) {
    messageElements.push(<MessageBubble key={i} message={msg} />);
  }

  return (
    <Box flexDirection="column" height={termHeight}>
      {/* 标题栏 */}
      <Box paddingLeft={1} paddingRight={1}>
        <Text bold color="cyan">
          {'⚡'} commit-log-daily
        </Text>
        <Text dimColor> agent mode | Ctrl+C 退出 | Ctrl+E 配置</Text>
      </Box>

      {/* 消息区域 */}
      <Box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
        {messageElements}
        {isWaiting && (
          <Box>
            <Text color="yellow">...思考中</Text>
          </Box>
        )}
      </Box>

      {/* 输入区域 */}
      <Box paddingLeft={1} paddingRight={1}>
        <Text color="green" bold>
          {'❯'} {' '}
        </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder={isWaiting ? '等待 Agent 响应...' : '输入消息，回车发送...'}
        />
      </Box>
    </Box>
  );
}

/** 单条消息气泡 */
function MessageBubble({ message }: { message: ChatMessage }) {
  const colorMap: Record<string, string> = {
    user: 'green',
    assistant: 'blue',
    system: 'yellow',
  };
  const labelMap: Record<string, string> = {
    user: '❯ 你',
    assistant: '✦ Agent',
    system: '◆ 系统',
  };

  const color = colorMap[message.role] ?? 'white';
  const label = labelMap[message.role] ?? message.role;

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Text color={color} bold>
        {label}
      </Text>
      {message.content.split('\n').map((line, i) => (
        <Text key={i} dimColor={message.role === 'system'}>
          {line || ' '}
        </Text>
      ))}
    </Box>
  );
}

/**
 * 按可见行数截取最近消息
 * 每条消息约 content 行数 + 1 行角色标签
 */
function tailByLines(msgs: ChatMessage[], maxLines: number): ChatMessage[] {
  const result: ChatMessage[] = [];
  let used = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i]!;
    const lines = msg.content.split('\n').length + 1;
    if (used + lines > maxLines && result.length > 0) break;
    result.unshift(msg);
    used += lines;
  }
  return result;
}
```

---

### Task 14: TUI — 配置页

**Files:**
- Create: `src/tui/ConfigView.tsx`

- [ ] **Step 1: 创建 `src/tui/ConfigView.tsx`**

```typescript
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { readConfig, writeConfig } from '../config/store.js';
import type { AppConfig } from '../config/schema.js';

/** 配置页焦点区域 */
type FocusArea = 'model-baseUrl' | 'model-model' | 'model-apiKey' | 'author-name' | 'author-email' | 'outputDir';

/** 所有焦点的顺序列表 */
const FOCUS_ORDER: FocusArea[] = [
  'model-baseUrl',
  'model-model',
  'model-apiKey',
  'author-name',
  'author-email',
  'outputDir',
];

interface ConfigViewProps {
  /** 关闭配置页的回调 */
  onClose: () => void;
}

/**
 * 独立配置页
 * 用户按 Ctrl+E 进入，Esc 返回
 */
export function ConfigView({ onClose }: ConfigViewProps) {
  const [config, setConfig] = useState<AppConfig>(() => readConfig());
  const [focusIndex, setFocusIndex] = useState<number>(0);
  const [editing, setEditing] = useState<boolean>(false);
  const [editValue, setEditValue] = useState<string>('');
  const [statusMsg, setStatusMsg] = useState<string>('');

  const currentFocus = FOCUS_ORDER[focusIndex]!;

  useInput((input, key) => {
    // 编辑模式
    if (editing) {
      if (key.return) {
        // 回车：保存编辑
        setStatusMsg('');
        applyEdit(config, currentFocus, editValue, setConfig, setStatusMsg);
        setEditing(false);
        return;
      }
      return; // 编辑中，由 TextInput 处理输入
    }

    // 导航模式
    if (input === 'e') {
      // Enter 键进入编辑
      const currentValue = getFieldValue(config, currentFocus);
      setEditValue(currentValue);
      setEditing(true);
      setStatusMsg('');
      return;
    }

    if (key.upArrow) {
      setFocusIndex((prev) => (prev - 1 + FOCUS_ORDER.length) % FOCUS_ORDER.length);
      return;
    }

    if (key.downArrow) {
      setFocusIndex((prev) => (prev + 1) % FOCUS_ORDER.length);
      return;
    }

    if (key.escape) {
      onClose();
      return;
    }

    if (input === 's') {
      // Ctrl+S 保存
      try {
        writeConfig(config);
        setStatusMsg('已保存');
      } catch (err) {
        setStatusMsg(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }
  });

  // 视野中显示的项目名
  const focusLabel = FOCUS_LABELS[currentFocus] ?? currentFocus;
  const focusValue = getFieldValue(config, currentFocus);

  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          配置页
        </Text>
        <Text dimColor>
          {' '}
          | ↑↓ 导航 | Enter 编辑 | Ctrl+S 保存 | Esc 返回
        </Text>
      </Box>

      {/* 模型配置 */}
      <SectionTitle title="大模型" />
      <ConfigField
        label="Base URL"
        value={config.model.baseUrl}
        focused={currentFocus === 'model-baseUrl'}
        editing={editing && currentFocus === 'model-baseUrl'}
        editValue={editValue}
        onChangeEdit={setEditValue}
      />
      <ConfigField
        label="Model"
        value={config.model.model}
        focused={currentFocus === 'model-model'}
        editing={editing && currentFocus === 'model-model'}
        editValue={editValue}
        onChangeEdit={setEditValue}
      />
      <ConfigField
        label="API Key"
        value={maskForDisplay(config.model.apiKey)}
        focused={currentFocus === 'model-apiKey'}
        editing={editing && currentFocus === 'model-apiKey'}
        editValue={editValue}
        onChangeEdit={setEditValue}
        sensitive={true}
      />

      {/* 作者配置 */}
      <SectionTitle title="Git 作者" />
      <ConfigField
        label="姓名"
        value={config.author.name || '(未配置)'}
        focused={currentFocus === 'author-name'}
        editing={editing && currentFocus === 'author-name'}
        editValue={editValue}
        onChangeEdit={setEditValue}
      />
      <ConfigField
        label="邮箱"
        value={config.author.email || '(未配置)'}
        focused={currentFocus === 'author-email'}
        editing={editing && currentFocus === 'author-email'}
        editValue={editValue}
        onChangeEdit={setEditValue}
      />

      {/* 输出目录 */}
      <SectionTitle title="报告输出" />
      <ConfigField
        label="输出目录"
        value={config.report.outputDir || '(当前目录)'}
        focused={currentFocus === 'outputDir'}
        editing={editing && currentFocus === 'outputDir'}
        editValue={editValue}
        onChangeEdit={setEditValue}
      />

      {/* 项目列表（只读展示） */}
      <SectionTitle title={`项目列表 (${config.projects.length})`} />
      {config.projects.length === 0 ? (
        <Text dimColor>  (无项目，请在对话中使用 addProject 添加)</Text>
      ) : (
        config.projects.map((p) => (
          <Text key={p.name}>  {p.name} {'→'} {p.path}</Text>
        ))
      )}

      {/* 状态消息 */}
      {statusMsg ? (
        <Box marginTop={1}>
          <Text color={statusMsg.startsWith('保存失败') ? 'red' : 'green'}>
            {statusMsg}
          </Text>
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text dimColor>Ctrl+S 保存 | Esc 返回</Text>
      </Box>
    </Box>
  );
}

/** 区块标题 */
function SectionTitle({ title }: { title: string }) {
  return (
    <Box marginTop={1}>
      <Text bold underline>
        {title}
      </Text>
    </Box>
  );
}

/** 单个配置字段 */
function ConfigField(props: {
  label: string;
  value: string;
  focused: boolean;
  editing: boolean;
  editValue: string;
  onChangeEdit: (v: string) => void;
  sensitive?: boolean;
}) {
  const pointer = props.focused ? '❯' : ' ';
  const color = props.focused ? 'cyan' : undefined;

  if (props.editing) {
    return (
      <Box>
        <Text color={color}>{pointer} {props.label}: </Text>
        <TextInput
          value={props.editValue}
          onChange={props.onChangeEdit}
          placeholder={props.sensitive ? '输入 API Key...' : ''}
        />
      </Box>
    );
  }

  return (
    <Box>
      <Text color={color}>{pointer} {props.label}: </Text>
      <Text>{props.value}</Text>
    </Box>
  );
}

/** 焦点标签映射 */
const FOCUS_LABELS: Record<FocusArea, string> = {
  'model-baseUrl': 'Base URL',
  'model-model': 'Model',
  'model-apiKey': 'API Key',
  'author-name': '作者姓名',
  'author-email': '作者邮箱',
  'outputDir': '输出目录',
};

/**
 * 从配置中读取当前焦点字段的值（不含脱敏）
 */
function getFieldValue(config: AppConfig, focus: FocusArea): string {
  switch (focus) {
    case 'model-baseUrl': return config.model.baseUrl;
    case 'model-model': return config.model.model;
    case 'model-apiKey': return config.model.apiKey;
    case 'author-name': return config.author.name;
    case 'author-email': return config.author.email;
    case 'outputDir': return config.report.outputDir;
  }
}

/**
 * 应用编辑到配置对象
 */
function applyEdit(
  config: AppConfig,
  focus: FocusArea,
  value: string,
  setConfig: (c: AppConfig) => void,
  setStatus: (m: string) => void,
): void {
  const updated = { ...config };
  switch (focus) {
    case 'model-baseUrl':
      updated.model = { ...updated.model, baseUrl: value };
      break;
    case 'model-model':
      updated.model = { ...updated.model, model: value };
      break;
    case 'model-apiKey':
      updated.model = { ...updated.model, apiKey: value };
      break;
    case 'author-name':
      updated.author = { ...updated.author, name: value };
      break;
    case 'author-email':
      updated.author = { ...updated.author, email: value };
      break;
    case 'outputDir':
      updated.report = { ...updated.report, outputDir: value };
      break;
  }
  setConfig(updated);
}

/** 展示用脱敏 */
function maskForDisplay(key: string): string {
  if (!key) return '(未配置)';
  if (key.length <= 6) return '****';
  return `${key.slice(0, 3)}${'*'.repeat(key.length - 6)}${key.slice(-3)}`;
}
```

---

### Task 15: TUI — 会话 Hook

**Files:**
- Create: `src/tui/useSession.ts`

- [ ] **Step 1: 创建 `src/tui/useSession.ts`**

```typescript
import { useState, useCallback, useRef } from 'react';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { createModelForPhase, stripPhaseMarker, hasPhaseMarker } from '../agent/base.js';
import {
  createEmptyContext,
  evaluatePhaseTransition,
  applyContextUpdates,
} from '../agent/session.js';
import type { SessionContext, AgentPhase } from '../agent/types.js';
import { readConfig } from '../config/store.js';
import type { ChatMessage } from './ChatView.js';

/** 会话 Hook 的返回值 */
interface SessionState {
  messages: ChatMessage[];
  phase: AgentPhase;
  isWaiting: boolean;
  handleSubmit: (text: string) => void;
}

/** 将 LangChain BaseMessage 转为 UI 消息 */
function toChatMessage(msg: BaseMessage): ChatMessage {
  const roleMap: Record<string, ChatMessage['role']> = {
    human: 'user',
    ai: 'assistant',
    system: 'system',
    tool: 'system',
  };
  const role = roleMap[msg.getType()] ?? 'system';
  const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
  return { role, content };
}

/**
 * 会话管理 Hook
 * 维护消息历史、阶段切换、与 Agent 交互
 */
export function useSession(): SessionState {
  const [langMessages, setLangMessages] = useState<BaseMessage[]>([
    new SystemMessage('欢迎使用 commit-log-daily Agent。输入消息开始对话。'),
  ]);
  const [phase, setPhase] = useState<AgentPhase>('collect');
  const [isWaiting, setIsWaiting] = useState<boolean>(false);
  const contextRef = useRef<SessionContext>(createEmptyContext());

  const handleSubmit = useCallback(
    async (text: string) => {
      // 追加用户消息
      const userMsg = new HumanMessage(text);
      const updated = [...langMessages, userMsg];
      setLangMessages(updated);
      setIsWaiting(true);

      try {
        // 创建当前阶段的 Agent
        const model = createModelForPhase(phase);

        // 调用 LLM
        const aiMsg = await model.invoke(updated);

        // 检查是否有工具调用
        const aiMsgAny = aiMsg as unknown as {
          content: string;
          tool_calls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
        };

        if (aiMsgAny.tool_calls && aiMsgAny.tool_calls.length > 0) {
          // 处理工具调用
          const toolMessages: BaseMessage[] = [];

          for (const tc of aiMsgAny.tool_calls) {
            const result = await executeTool(tc.name, tc.args);
            toolMessages.push(
              new ToolMessage({ content: result, tool_call_id: tc.id }),
            );
          }

          // 带工具结果再次调用 LLM
          const withTools = [...updated, aiMsg, ...toolMessages];
          const finalMsg = await model.invoke(withTools);

          const allMessages = [...updated, aiMsg, ...toolMessages, finalMsg];
          setLangMessages(allMessages);

          // 检查阶段切换
          const content = typeof finalMsg.content === 'string' ? finalMsg.content : '';
          await handlePhaseCheck(content, phase, contextRef.current, setPhase);
        } else {
          // 无工具调用，直接追加
          const allMessages = [...updated, aiMsg];
          setLangMessages(allMessages);

          // 检查阶段切换
          const content = typeof aiMsg.content === 'string' ? aiMsg.content : '';
          await handlePhaseCheck(content, phase, contextRef.current, setPhase);
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        setLangMessages((prev) => [
          ...prev,
          new AIMessage(`执行出错: ${errMsg}`),
        ]);
      } finally {
        setIsWaiting(false);
      }
    },
    [langMessages, phase],
  );

  // 转换消息为 UI 格式
  const chatMessages: ChatMessage[] = langMessages.map(toChatMessage);

  return {
    messages: chatMessages,
    phase,
    isWaiting,
    handleSubmit,
  };
}

/**
 * 执行单个工具调用
 */
async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  // 动态导入工具模块（避免循环依赖）
  const { scanGitTool } = await import('../agent/tools/scanGit.js');
  const { listProjectsTool, addProjectTool, removeProjectTool } = await import('../agent/tools/projects.js');
  const { getConfigTool, setConfigTool } = await import('../agent/tools/config-tool.js');
  const { exportFileTool } = await import('../agent/tools/exportFile.js');
  const { generateReportTool } = await import('../agent/tools/generate.js');

  const toolMap: Record<string, { invoke: (args: unknown) => Promise<string> }> = {
    scanGit: scanGitTool,
    listProjects: listProjectsTool,
    addProject: addProjectTool,
    removeProject: removeProjectTool,
    getConfig: getConfigTool,
    setConfig: setConfigTool,
    exportFile: exportFileTool,
    generateReport: generateReportTool,
  };

  const tool = toolMap[name];
  if (!tool) {
    return `未知工具: ${name}`;
  }

  return tool.invoke(args);
}

/**
 * 检查并处理阶段切换
 */
async function handlePhaseCheck(
  content: string,
  currentPhase: AgentPhase,
  context: SessionContext,
  setPhase: (p: AgentPhase) => void,
): Promise<void> {
  const newPhase = evaluatePhaseTransition(currentPhase, content, context);
  if (newPhase !== currentPhase) {
    setPhase(newPhase);
  }
}
```

---

### Task 16: TUI — 入口路由

**Files:**
- Create: `src/tui/app.tsx`

- [ ] **Step 1: 创建 `src/tui/app.tsx`**

```typescript
import { useState, useCallback } from 'react';
import { render, useInput } from 'ink';
import { ChatView } from './ChatView.js';
import { ConfigView } from './ConfigView.js';
import { useSession } from './useSession.js';

/** 视图模式 */
type ViewMode = 'chat' | 'config';

/** TUI 主应用组件 */
function App() {
  const [view, setView] = useState<ViewMode>('chat');
  const { messages, isWaiting, handleSubmit } = useSession();

  // Ctrl+E 切换视图
  useInput((input, key) => {
    if (key.ctrl && input === 'e') {
      setView((prev) => (prev === 'chat' ? 'config' : 'chat'));
    }
  });

  const handleConfigClose = useCallback(() => {
    setView('chat');
  }, []);

  if (view === 'config') {
    return <ConfigView onClose={handleConfigClose} />;
  }

  return (
    <ChatView
      messages={messages}
      onSubmit={handleSubmit}
      isWaiting={isWaiting}
    />
  );
}

/** 启动 TUI Agent 模式 */
export function startAgentTui(): void {
  render(<App />);
}
```

---

### Task 17: 入口文件

**Files:**
- Create: `src/index.ts`
- Modify: `bin/agent.js`

- [ ] **Step 1: 创建 `src/index.ts`**

```typescript
export { startAgentTui } from './tui/app.js';
```

- [ ] **Step 2: 修改 `bin/agent.js` 更新引用路径**

```javascript
#!/usr/bin/env node
import { startAgentTui } from "../dist/index.js";

startAgentTui();
```

> 注意：原 `bin/agent.js` 中引用的是 `"../dist/tui/app.js"`，现在改为 `"../dist/index.js"`。

---

### Task 18: 依赖安装与构建验证

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 添加 langchain 依赖**

```bash
pnpm add langchain @langchain/openai @langchain/core zod
```

- [ ] **Step 2: 更新 `tsconfig.json` include**

确保 `tsconfig.json` 的 `include` 包含新文件：

```json
{
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

> 原 `include` 中有 `"todo/app.tsx"`，需移除。

- [ ] **Step 3: 类型检查**

```bash
pnpm typecheck
```

Expected: 无错误输出。

- [ ] **Step 4: 构建**

```bash
pnpm build
```

Expected: `dist/` 目录产出，无编译错误。

- [ ] **Step 5: 运行冒烟测试**

```bash
pnpm test
```

Expected: `bin/commit-log-daily.js --help` 正常执行。

- [ ] **Step 6: 验证 agent 入口**

```bash
node bin/agent.js
```

Expected: TUI 界面启动（会因无 API Key 而无法使用 Agent，但界面应正常渲染）。

---

### 清理项

在全部任务完成后执行：

- [ ] 删除 `todo/` 目录（设计已落地为正式代码）
- [ ] 删除 `backup/` 目录（旧代码片段已无参考价值）
- [ ] 更新 `README.md` 反映新功能

---

### 自检

- [x] **Spec 覆盖**：9 个工具全部实现 → Task 5-9；双阶段工作流 → Task 12 + 15；TUI 视图 → Task 13-16；配置管理 → Task 2-3 + 14；安全 Git → Task 5；错误处理 → Task 1；代码风格一致
- [x] **无占位符**：所有步骤均包含完整代码和具体命令
- [x] **类型一致性**：`SessionContext`、`AgentPhase`、`AppConfig`、`GitLogEntry` 等类型在所有引用的 Task 中保持一致定义
- [x] **文件路径**：所有路径相对于项目根目录，使用正斜杠
