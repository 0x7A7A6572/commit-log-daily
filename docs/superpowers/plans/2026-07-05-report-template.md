# 用户自定义报告模板 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许用户通过 `.md` 模板文件自定义日报/周报/月报的格式和风格，替代当前硬编码的报告结构。

**Architecture:** 模板文件存于 `~/.commit-log-daily/templates/`，以 `<!-- DATA -->` 分隔 Prompt 指令段和 Markdown 骨架段。生成报告时，模板通过 System Prompt 注入。6 个 Agent 工具（collect 阶段）提供模板 CRUD，TUI 新增 `/templates` 视图管理。`createModelForPhase` 改为返回 `{ invoke, systemPrompt }`，`useSession.ts` 在每个 phase 使用对应的 System Prompt。

**Tech Stack:** TypeScript 5.8+, Node.js 18+, pnpm, Ink 7, Zod v4, LangChain, better-sqlite3

---

## 文件总览

### 新增

| 文件 | 职责 |
|------|------|
| `src/template/store.ts` | 模板文件 CRUD — list / read / create / update / delete / setDefault |
| `src/template/resolver.ts` | 读取模板文件，解析出 `promptSection` 和 `skeletonSection` |
| `src/agent/tools/template-tool.ts` | 6 个模板工具的 Zod schema + `tool()` 定义 |
| `src/tui/TemplatesView.tsx` | 模板管理 TUI 视图 — 列表、预览、设默认、删除 |

### 变更

| 文件 | 变更内容 |
|------|----------|
| `src/config/schema.ts` | `reportSchema` 新增 `template` 字段（default: `'default'`） |
| `src/agent/base.ts` | `createModelForPhase` 返回 `{ invoke, systemPrompt }`；generate 阶段调用 `resolveTemplateForPrompt` |
| `src/tui/useSession.ts` | 使用 `PhaseModel` 新接口，消息列表中注入 phase 对应的 System Prompt |
| `src/tui/app.tsx` | ViewMode 加 `'templates'`，路由加 TemplatesView |
| `src/tui/ChatView.tsx` | SLASH_COMMANDS 加 `/templates` 条目 |

---

### Task 1: 配置 Schema — 新增 template 字段

**Files:**
- Modify: `src/config/schema.ts` (第 22-25 行, 第 51-65 行)

- [ ] **Step 1: 修改 `reportSchema` 和 `DEFAULT_CONFIG`**

```ts
// src/config/schema.ts — reportSchema (约第 22 行)
/** 报告配置 schema */
const reportSchema = z.object({
  outputDir: z.string(),
  template: z.string().default('default'),
});
```

```ts
// src/config/schema.ts — DEFAULT_CONFIG (约第 51 行)
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
};
```

- [ ] **Step 2: 运行类型检查**

```
pnpm typecheck
```
预期: 无类型错误。

- [ ] **Step 3: 提交**

```bash
git add src/config/schema.ts
git commit -m "feat(config): reportSchema 新增 template 字段，默认 'default'"
```

---

### Task 2: 模板文件存储 — store.ts

**Files:**
- Create: `src/template/store.ts`

- [ ] **Step 1: 创建 `src/template/store.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readConfig, writeConfig } from '../config/store.js';

/** 模板文件目录 */
const TEMPLATE_DIR = path.join(os.homedir(), '.commit-log-daily', 'templates');

/** 内置默认模板名（只读，不可更新/删除） */
const BUILTIN_TEMPLATE = 'default';

/** 确保模板目录存在 */
function ensureDir(): void {
  if (!fs.existsSync(TEMPLATE_DIR)) {
    fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
  }
}

/** 模板文件完整路径 */
function templatePath(name: string): string {
  return path.join(TEMPLATE_DIR, `${name}.md`);
}

/** 列出所有模板文件 */
export function listTemplates(): Array<{ filename: string; isDefault: boolean }> {
  ensureDir();
  const config = readConfig();
  const defaultName = config.report.template;

  const entries: Array<{ filename: string; isDefault: boolean }> = [];

  // 内置 default 始终在列表中
  entries.push({ filename: BUILTIN_TEMPLATE, isDefault: defaultName === BUILTIN_TEMPLATE });

  // 扫描 .md 文件（排除内置 default，它不对应实际文件）
  if (fs.existsSync(TEMPLATE_DIR)) {
    const files = fs.readdirSync(TEMPLATE_DIR);
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      const name = f.slice(0, -3);
      if (name === BUILTIN_TEMPLATE) continue;
      entries.push({ filename: name, isDefault: defaultName === name });
    }
  }

  return entries;
}

/** 读取模板文件内容 */
export function readTemplate(name: string): string {
  // 内置 default 返回空字符串（调用方应使用 GENERATE_SYSTEM_PROMPT）
  if (name === BUILTIN_TEMPLATE) {
    return '';
  }

  ensureDir();
  const filePath = templatePath(name);

  if (!fs.existsSync(filePath)) {
    throw new Error(`模板 "${name}" 不存在`);
  }

  return fs.readFileSync(filePath, 'utf-8');
}

/** 创建新模板文件 */
export function createTemplate(name: string, content: string): void {
  if (name === BUILTIN_TEMPLATE) {
    throw new Error(`"${BUILTIN_TEMPLATE}" 是内置模板，不可创建`);
  }

  ensureDir();
  const filePath = templatePath(name);

  if (fs.existsSync(filePath)) {
    throw new Error(`模板 "${name}" 已存在，请使用 updateTemplate 更新`);
  }

  fs.writeFileSync(filePath, content, 'utf-8');
}

/** 更新模板文件内容 */
export function updateTemplate(name: string, content: string): void {
  if (name === BUILTIN_TEMPLATE) {
    throw new Error(`"${BUILTIN_TEMPLATE}" 是内置默认模板，不可更新`);
  }

  ensureDir();
  const filePath = templatePath(name);

  if (!fs.existsSync(filePath)) {
    throw new Error(`模板 "${name}" 不存在`);
  }

  fs.writeFileSync(filePath, content, 'utf-8');
}

/** 删除模板文件 */
export function deleteTemplate(name: string): void {
  if (name === BUILTIN_TEMPLATE) {
    throw new Error(`"${BUILTIN_TEMPLATE}" 是内置默认模板，不可删除`);
  }

  const filePath = templatePath(name);

  if (!fs.existsSync(filePath)) {
    throw new Error(`模板 "${name}" 不存在`);
  }

  fs.unlinkSync(filePath);
}

/** 设置默认模板（持久化到 config.json） */
export function setDefaultTemplate(name: string): void {
  // 内置 default 或实际存在的模板文件都可以
  if (name !== BUILTIN_TEMPLATE) {
    const filePath = templatePath(name);
    if (!fs.existsSync(filePath)) {
      throw new Error(`模板 "${name}" 不存在`);
    }
  }

  const config = readConfig();
  config.report.template = name;
  writeConfig(config);
}

/** 导出模板目录路径，供 resolver 使用 */
export { TEMPLATE_DIR };
```

- [ ] **Step 2: 运行类型检查**

```
pnpm typecheck
```
预期: 无类型错误。

- [ ] **Step 3: 提交**

```bash
git add src/template/store.ts
git commit -m "feat(template): 模板文件 CRUD 存储层"
```

---

### Task 3: 模板解析器 — resolver.ts

**Files:**
- Create: `src/template/resolver.ts`

- [ ] **Step 1: 创建 `src/template/resolver.ts`**

```ts
import { readTemplate } from './store.js';
import { readConfig } from '../config/store.js';

/** 模板解析结果 */
export interface TemplateSections {
  /** Prompt 指令段（<!-- DATA --> 之上），为 null 表示无分隔线 */
  promptSection: string | null;
  /** Markdown 骨架段（<!-- DATA --> 之下） */
  skeletonSection: string;
}

/** 分隔标记 */
const DATA_MARKER = '<!-- DATA -->';

/**
 * 解析模板内容，将 Prompt 段和骨架段分离
 */
function parseTemplate(content: string): TemplateSections {
  const idx = content.indexOf(DATA_MARKER);

  if (idx === -1) {
    // 无分隔线 — 整个文件视为骨架
    return {
      promptSection: null,
      skeletonSection: content.trim(),
    };
  }

  const promptSection = content.slice(0, idx).trim();
  const skeletonSection = content.slice(idx + DATA_MARKER.length).trim();

  return {
    promptSection: promptSection || null,
    skeletonSection: skeletonSection || '',
  };
}

/**
 * 根据当前配置解析模板，返回用于拼入 System Prompt 的文本
 *
 * 返回 null → 使用内置默认模板（调用方应使用 GENERATE_SYSTEM_PROMPT 原文）
 */
export function resolveTemplateForPrompt(): { promptFragment: string; skeletonFragment: string } | null {
  const config = readConfig();
  const templateName = config.report.template;

  // 内置默认模板 — 返回 null
  if (templateName === 'default') {
    return null;
  }

  try {
    const content = readTemplate(templateName);
    const { promptSection, skeletonSection } = parseTemplate(content);

    const promptFragment = promptSection
      ? `---\n模板指令（用户自定义）:\n${promptSection}`
      : '';

    const skeletonFragment = skeletonSection
      ? `---\n报告骨架参考（用户自定义）:\n${skeletonSection}`
      : '';

    return { promptFragment, skeletonFragment };
  } catch {
    // 模板读取失败 — 回退默认
    return null;
  }
}
```

- [ ] **Step 2: 运行类型检查**

```
pnpm typecheck
```
预期: 无类型错误。

- [ ] **Step 3: 提交**

```bash
git add src/template/resolver.ts
git commit -m "feat(template): 模板解析器 — 分离 Prompt 段和骨架段"
```

---

### Task 4: 模板 Agent 工具 — template-tool.ts

**Files:**
- Create: `src/agent/tools/template-tool.ts`

- [ ] **Step 1: 创建 `src/agent/tools/template-tool.ts`**

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  listTemplates as listTemplatesFn,
  readTemplate as readTemplateFn,
  createTemplate as createTemplateFn,
  updateTemplate as updateTemplateFn,
  deleteTemplate as deleteTemplateFn,
  setDefaultTemplate as setDefaultTemplateFn,
} from '../../template/store.js';

/** 列出所有模板文件 */
export const listTemplatesTool = tool(
  async () => {
    const list = listTemplatesFn();
    if (list.length === 0) {
      return '当前没有可用的模板文件。';
    }
    const lines = list.map(
      (t) => `- ${t.filename}${t.isDefault ? ' (默认)' : ''}`,
    );
    return `可用模板（共 ${list.length} 个）：\n${lines.join('\n')}`;
  },
  {
    name: 'listTemplates',
    description: '列出所有可用的报告模板文件，标注当前默认模板。',
    schema: z.object({}),
  },
);

/** 读取指定模板的完整内容 */
export const readTemplateTool = tool(
  async ({ template: name }) => {
    try {
      const content = readTemplateFn(name);
      if (content === '') {
        return `"${name}" 是内置默认模板。其内容为系统预设的报告格式（核心产出、问题修复、技术优化、其他工作、下一步计划），不可直接编辑。如需自定义，请使用 createTemplate 创建新模板。`;
      }
      return `模板 "${name}" 的内容：\n\n${content}`;
    } catch (err) {
      return `读取失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: 'readTemplate',
    description: '读取指定模板文件的完整内容，包括 Prompt 指令段和 Markdown 骨架段。',
    schema: z.object({
      template: z.string().describe('模板文件名，不含 .md 扩展名'),
    }),
  },
);

/** 创建新模板文件 */
export const createTemplateTool = tool(
  async ({ template: name, content }) => {
    try {
      createTemplateFn(name, content);
      return `模板 "${name}" 已创建。`;
    } catch (err) {
      return `创建失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: 'createTemplate',
    description:
      '创建一个新的报告模板文件。模板内容分为两段：<!-- DATA --> 之上是 Prompt 指令（告诉 LLM 怎么写），之下是 Markdown 骨架（报告结构参考）。如果不写 <!-- DATA -->，整个内容视为骨架。',
    schema: z.object({
      template: z.string().describe('模板文件名，不含 .md 扩展名'),
      content: z.string().describe('模板完整内容，Prompt 指令段 + <!-- DATA --> + Markdown 骨架段'),
    }),
  },
);

/** 更新已有模板 */
export const updateTemplateTool = tool(
  async ({ template: name, content }) => {
    try {
      updateTemplateFn(name, content);
      return `模板 "${name}" 已更新。`;
    } catch (err) {
      return `更新失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: 'updateTemplate',
    description:
      '更新已有模板文件的内容。注意：内置 default 模板不可更新，需要先创建自定义模板。',
    schema: z.object({
      template: z.string().describe('模板文件名，不含 .md 扩展名'),
      content: z.string().describe('模板完整新内容'),
    }),
  },
);

/** 删除模板 */
export const deleteTemplateTool = tool(
  async ({ template: name }) => {
    try {
      deleteTemplateFn(name);
      return `模板 "${name}" 已删除。`;
    } catch (err) {
      return `删除失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: 'deleteTemplate',
    description: '删除一个模板文件。注意：内置 default 模板不可删除。',
    schema: z.object({
      template: z.string().describe('要删除的模板文件名，不含 .md 扩展名'),
    }),
  },
);

/** 设置默认模板 */
export const setDefaultTemplateTool = tool(
  async ({ template: name }) => {
    try {
      setDefaultTemplateFn(name);
      return `已将默认模板设置为 "${name}"。后续生成报告时将使用此模板。`;
    } catch (err) {
      return `设置失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: 'setDefaultTemplate',
    description: '设置默认报告模板。后续所有报告生成都将使用此模板（也可在对话中临时切换）。',
    schema: z.object({
      template: z.string().describe('模板文件名，不含 .md 扩展名。设为 "default" 恢复系统默认格式。'),
    }),
  },
);
```

- [ ] **Step 2: 运行类型检查**

```
pnpm typecheck
```
预期: 无类型错误。

- [ ] **Step 3: 提交**

```bash
git add src/agent/tools/template-tool.ts
git commit -m "feat(template): 6 个模板 Agent 工具 — list/read/create/update/delete/setDefault"
```

---

### Task 5: base.ts — createModelForPhase 返回 System Prompt

**Files:**
- Modify: `src/agent/base.ts` (整文件重写)

- [ ] **Step 1: 重写 `src/agent/base.ts`**

```ts
import type { BaseMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { readConfig } from '../config/store.js';
import type { AgentPhase } from './types.js';

import { scanGitTool } from './tools/scanGit.js';
import { listProjectsTool, addProjectTool, removeProjectTool } from './tools/projects.js';
import { getConfigTool, setConfigTool } from './tools/config-tool.js';
import { writeFileTool } from './tools/exportFile.js';
import { generateReportTool } from './tools/generate.js';
import { findGitReposTool } from './tools/findGitRepos.js';
import { COLLECT_SYSTEM_PROMPT, GENERATE_SYSTEM_PROMPT } from './prompts/system.js';
import { resolveTemplateForPrompt } from '../template/resolver.js';

/** collect 阶段可用工具 */
const COLLECT_TOOLS = [
  scanGitTool,
  listProjectsTool,
  addProjectTool,
  removeProjectTool,
  getConfigTool,
  setConfigTool,
  findGitReposTool,
];

/** generate 阶段可用工具 */
const GENERATE_TOOLS = [
  generateReportTool,
  writeFileTool,
];

/** createModelForPhase 的返回值类型 */
export interface PhaseModel {
  invoke: (messages: BaseMessage[]) => Promise<BaseMessage>;
  systemPrompt: string;
}

/**
 * 根据阶段创建 ChatOpenAI 实例 + System Prompt
 * 每次调用重新读取配置，确保使用最新配置（含对话中修改）
 */
export function createModelForPhase(phase: AgentPhase): PhaseModel {
  const config = readConfig();

  // 规范化 baseUrl：确保以 /v1 结尾（兼容用户漏写 /v1 的情况）
  let baseUrl = config.model.baseUrl;
  if (!baseUrl.endsWith('/v1') && !baseUrl.endsWith('/v1/')) {
    baseUrl = baseUrl.replace(/\/$/, '') + '/v1';
  }

  const model = new ChatOpenAI({
    model: config.model.model,
    temperature: 0,
    configuration: {
      baseURL: baseUrl,
      apiKey: config.model.apiKey,
    },
  });

  const tools = phase === 'collect' ? COLLECT_TOOLS : GENERATE_TOOLS;
  const runnable = model.bindTools(tools);
  const systemPrompt = phase === 'collect' ? COLLECT_SYSTEM_PROMPT : buildGeneratePrompt();

  return {
    invoke: (messages: BaseMessage[]) => runnable.invoke(messages),
    systemPrompt,
  };
}

/**
 * 构建 generate 阶段 System Prompt
 * 优先使用用户自定义模板，否则使用内置 GENERATE_SYSTEM_PROMPT
 */
function buildGeneratePrompt(): string {
  const resolved = resolveTemplateForPrompt();

  if (!resolved) {
    return GENERATE_SYSTEM_PROMPT;
  }

  const parts: string[] = [GENERATE_SYSTEM_PROMPT];

  if (resolved.promptFragment) {
    parts.push(resolved.promptFragment);
  }

  if (resolved.skeletonFragment) {
    parts.push(resolved.skeletonFragment);
  }

  return parts.join('\n\n');
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

- [ ] **Step 2: 运行类型检查**

```
pnpm typecheck
```
预期: `PhaseModel` 的 `invoke` 类型与 `Runnable.invoke` 兼容，无类型错误。

- [ ] **Step 3: 提交**

```bash
git add src/agent/base.ts
git commit -m "feat(template): createModelForPhase 返回 PhaseModel，generate 阶段注入模板到 System Prompt"
```

---

### Task 6: useSession.ts — 适配 PhaseModel 新接口

**Files:**
- Modify: `src/tui/useSession.ts` (第 156 行、第 197 行、第 262-287 行)

- [ ] **Step 1: 更新模型调用，使用 `systemPrompt` 注入消息列表**

修改 `src/tui/useSession.ts`：

在第 156 行附近，将：
```ts
const model = createModelForPhase(phase);
```
改为：
```ts
const phaseModel = createModelForPhase(phase);
```

在第 162 行附近，将：
```ts
let currentAiMsg: BaseMessage = await model.invoke(runningMessages);
```
改为：
```ts
let currentAiMsg: BaseMessage = await phaseModel.invoke(runningMessages);
```

在第 197 行附近，将：
```ts
currentAiMsg = await model.invoke(runningMessages);
```
改为：
```ts
currentAiMsg = await phaseModel.invoke(runningMessages);
```

在第 262-287 行，`executeTool` 函数中新增 6 个模板工具的注册：

在现有 `import` 语句组后添加：
```ts
import { listTemplatesTool, readTemplateTool, createTemplateTool, updateTemplateTool, deleteTemplateTool, setDefaultTemplateTool } from '../agent/tools/template-tool.js';
```

在 `toolMap` 对象中添加：
```ts
listTemplates: listTemplatesTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
readTemplate: readTemplateTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
createTemplate: createTemplateTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
updateTemplate: updateTemplateTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
deleteTemplate: deleteTemplateTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
setDefaultTemplate: setDefaultTemplateTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
```

- [ ] **Step 2: 在 collect 阶段的 System Prompt 注入**

将 `useSession.ts` 约第 128 行的初始状态，从：
```ts
const [langMessages, setLangMessages] = useState<BaseMessage[]>([
  new SystemMessage(WELCOME_MESSAGE),
]);
```
改为：
```ts
const [langMessages, setLangMessages] = useState<BaseMessage[]>([
  new SystemMessage(WELCOME_MESSAGE),
]);
// 注意：collect 阶段的 System Prompt（COLLECT_SYSTEM_PROMPT）在每次 handleSubmit 中
// 通过 phaseModel.invoke 前动态注入，此处的 WELCOME_MESSAGE 仅用于初始渲染
```

然后将 `handleSubmit` 中 invoke 调用改为传入 System Prompt：

```ts
// 在第 162 行附近，invoke 之前注入 system prompt
const messagesWithSystem: BaseMessage[] = [
  new SystemMessage(phaseModel.systemPrompt),
  ...runningMessages.filter((m) => m.getType() !== 'system'),
];
let currentAiMsg: BaseMessage = await phaseModel.invoke(messagesWithSystem);
```

同理，在第 197 行附近的循环内：
```ts
const messagesWithSystem: BaseMessage[] = [
  new SystemMessage(phaseModel.systemPrompt),
  ...runningMessages.filter((m) => m.getType() !== 'system'),
];
currentAiMsg = await phaseModel.invoke(messagesWithSystem);
```

- [ ] **Step 3: 运行类型检查**

```
pnpm typecheck
```
预期: 无类型错误。

- [ ] **Step 4: 提交**

```bash
git add src/tui/useSession.ts
git commit -m "feat(template): useSession 适配 PhaseModel，注入 phase 对应 System Prompt，注册模板工具"
```

---

### Task 7: TemplatesView.tsx — 模板管理 TUI 视图

**Files:**
- Create: `src/tui/TemplatesView.tsx`

- [ ] **Step 1: 创建 `src/tui/TemplatesView.tsx`**

参考 `ProjectsView.tsx`（键盘导航模式）和 `ConfigView.tsx`（列表选择 + 操作），实现：

```tsx
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import {
  listTemplates,
  readTemplate,
  deleteTemplate as deleteTemplateFn,
  setDefaultTemplate as setDefaultFn,
} from '../template/store.js';

type Mode = 'list' | 'preview' | 'delete-confirm';

interface TemplatesViewProps {
  onBack: () => void;
}

export function TemplatesView({ onBack }: TemplatesViewProps) {
  const [templates, setTemplates] = useState(() => listTemplates());
  const [focusIndex, setFocusIndex] = useState<number>(0);
  const [mode, setMode] = useState<Mode>('list');
  const [previewContent, setPreviewContent] = useState<string>('');
  const [statusMsg, setStatusMsg] = useState<string>('');

  const refreshList = () => {
    setTemplates(listTemplates());
  };

  useInput((input, key) => {
    // 预览模式
    if (mode === 'preview') {
      if (key.escape || input === 'b' || input === 'B') {
        setMode('list');
        return;
      }
      return;
    }

    // 删除确认模式
    if (mode === 'delete-confirm') {
      if (input === 'y' || input === 'Y') {
        const tmpl = templates[focusIndex];
        if (tmpl) {
          try {
            deleteTemplateFn(tmpl.filename);
            setStatusMsg(`模板 "${tmpl.filename}" 已删除`);
            refreshList();
            if (focusIndex >= templates.length - 1 && templates.length > 1) {
              setFocusIndex(templates.length - 2);
            }
          } catch (err) {
            setStatusMsg(`删除失败: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        setMode('list');
        return;
      }
      if (input === 'n' || input === 'N' || key.escape) {
        setMode('list');
        return;
      }
      return;
    }

    // 列表模式
    if (key.upArrow) {
      setFocusIndex((prev) => (prev - 1 + Math.max(templates.length, 1)) % Math.max(templates.length, 1));
      return;
    }

    if (key.downArrow) {
      setFocusIndex((prev) => (prev + 1) % Math.max(templates.length, 1));
      return;
    }

    if (input === 'v' || input === 'V') {
      // 预览
      const tmpl = templates[focusIndex];
      if (tmpl) {
        try {
          const content = readTemplate(tmpl.filename);
          setPreviewContent(content || '(内置默认模板 — 核心产出、问题修复、技术优化、其他工作、下一步计划)');
          setMode('preview');
        } catch (err) {
          setStatusMsg(`预览失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return;
    }

    if (input === 'd' || input === 'D') {
      const tmpl = templates[focusIndex];
      if (!tmpl) return;
      if (tmpl.filename === 'default') {
        setStatusMsg('内置 default 模板不可删除');
        return;
      }
      setMode('delete-confirm');
      return;
    }

    if (input === 's' || input === 'S') {
      const tmpl = templates[focusIndex];
      if (!tmpl) return;
      try {
        setDefaultFn(tmpl.filename);
        setStatusMsg(`已将默认模板设为 "${tmpl.filename}"`);
        refreshList();
      } catch (err) {
        setStatusMsg(`设置失败: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (key.escape) {
      onBack();
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      {/* 标题栏 */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">
          commit-log-daily · 模板管理
        </Text>
        <Text dimColor>
          ↑↓ 选择  V 预览  S 设为默认  D 删除  Esc 返回
        </Text>
      </Box>

      {/* 预览模式 */}
      {mode === 'preview' && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>模板预览 — {templates[focusIndex]?.filename}</Text>
          <Box marginTop={1} flexDirection="column">
            {previewContent.split('\n').map((line, i) => (
              <Text key={i}>{line || ' '}</Text>
            ))}
          </Box>
          <Box marginTop={1}>
            <Text dimColor>B 或 Esc 返回列表</Text>
          </Box>
        </Box>
      )}

      {/* 删除确认 */}
      {mode === 'delete-confirm' && templates[focusIndex] && (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">
            确认删除模板 "{templates[focusIndex]!.filename}"？
          </Text>
          <Text dimColor>Y 确认 / N 或 Esc 取消</Text>
        </Box>
      )}

      {/* 模板列表 */}
      {mode === 'list' && templates.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor>  暂无模板文件。在 ~/.commit-log-daily/templates/ 下创建 .md 文件，或通过 Agent 对话创建。</Text>
        </Box>
      )}

      {mode === 'list' && templates.map((t, i) => {
        const isFocused = i === focusIndex;
        const pointer = isFocused ? '❯' : ' ';
        const color = isFocused ? 'cyan' : undefined;
        const isBuiltin = t.filename === 'default';

        return (
          <Box key={t.filename}>
            <Text color={color}>
              {pointer} {t.filename}{t.isDefault ? ' ★' : ''}{isBuiltin ? ' 🔒' : ''}
            </Text>
          </Box>
        );
      })}

      {/* 状态消息 */}
      {statusMsg && mode === 'list' && (
        <Box marginTop={1}>
          <Text color={statusMsg.includes('失败') || statusMsg.includes('不可') ? 'red' : 'green'}>
            {statusMsg}
          </Text>
        </Box>
      )}

      {/* 底部提示 */}
      <Box marginTop={1}>
        <Text dimColor>★ 默认模板  🔒 内置只读  ·  ~/.commit-log-daily/templates/</Text>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: 运行类型检查**

```
pnpm typecheck
```
预期: 无类型错误。

- [ ] **Step 3: 提交**

```bash
git add src/tui/TemplatesView.tsx
git commit -m "feat(template): TemplatesView — 模板列表、预览、设默认、删除"
```

---

### Task 8: app.tsx + ChatView.tsx — 路由和斜杠命令

**Files:**
- Modify: `src/tui/app.tsx` (第 2 行、第 11 行、第 23-38 行、第 65-67 行)
- Modify: `src/tui/ChatView.tsx` (第 20-26 行)

- [ ] **Step 1: 修改 `src/tui/ChatView.tsx`，添加 `/templates` 命令**

在 `SLASH_COMMANDS` 数组中（约第 20 行），`/projects` 条目之后添加：
```tsx
{ name: "/templates", description: "管理报告模板", action: "templates" },
```

- [ ] **Step 2: 修改 `src/tui/app.tsx`**

第 2 行附近，添加 import：
```ts
import { TemplatesView } from './TemplatesView.js';
```

第 11 行，ViewMode 添加 `'templates'`：
```ts
type ViewMode = 'chat' | 'config' | 'history' | 'projects' | 'templates';
```

第 24 行附近，handleCommand switch 添加：
```ts
case 'templates':
  setView('templates');
  break;
```

第 65-67 行，在 projects 路由之后、chat 路由之前添加：
```tsx
if (view === 'templates') {
  return <TemplatesView onBack={() => setView('chat')} />;
}
```

- [ ] **Step 3: 编译验证**

```
pnpm typecheck && pnpm build
```
预期: 编译成功，/templates 斜杠命令出现在菜单中，Enter 进入模板管理页。

- [ ] **Step 4: 提交**

```bash
git add src/tui/app.tsx src/tui/ChatView.tsx
git commit -m "feat(template): /templates 斜杠命令 + 视图路由"
```

---

### Task 9: 编译验证 + 冒烟测试

**Files:** 无新文件

- [ ] **Step 1: 完整编译**

```
pnpm build
```
预期: 无编译错误和类型错误。

- [ ] **Step 2: 冒烟测试 — 验证模板工具注册**

启动 TUI 后，在对话中输入 `/templates` 查看模板列表。确认：
- `default` 在列表中，标为默认且带锁
- 按 `S` 设默认、`V` 预览、`D` 删除操作正常
- 按 `Esc` 返回聊天

- [ ] **Step 3: 冒烟测试 — 验证模板注入生成**

在 `~/.commit-log-daily/templates/` 下创建 `test.md`，内容：
```markdown
生成报告时标题使用"工作日志"，不要用"核心产出"这个词。

<!-- DATA -->

# 工作日志
## 本周工作
## 遗留问题
```

在对话中：
1. 输入 `/config` 查看模板配置
2. 在对话中告诉 Agent："用 test 模板帮我生成一份今天的报告"
3. Agent 应调用 `setDefaultTemplate("test")`
4. 生成的报告标题应为"工作日志"而非默认格式

预期: 报告按 test 模板格式生成。

- [ ] **Step 4: 提交（如有修正）**

```bash
git add -u
git commit -m "fix(template): 冒烟测试修正"
```
