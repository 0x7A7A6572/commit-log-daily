# writeFile 工具重命名与健壮性增强 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `exportFile` 工具重命名为 `writeFile`，优化描述让 LLM 正确识别，输出目录不存在时自动创建。

**Architecture:** 纯重命名 + 一处行为增强。涉及 4 个文件的同步重命名和 2 处 Prompt 文本改动。不改架构、不改接口、不改测试策略。

**Tech Stack:** TypeScript, LangChain tool(), Node.js fs

---

### Task 1: 重命名工具并增加自动建目录

**Files:**
- Modify: `src/agent/tools/exportFile.ts`（全文件重写）

- [ ] **Step 1: 重写 `src/agent/tools/exportFile.ts`**

将文件内容替换为以下代码（工具名改为 `writeFile`，描述直白化，`fs.mkdirSync` 自动创建目录，`fs.existsSync` 检查改为 try-catch 写）：

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

/** 将内容写入磁盘保存为文件的工具 */
export const writeFileTool = tool(
  async ({ content, filename }) => {
    const config = readConfig();
    const outputDir = config.report.outputDir || process.cwd();

    // 确保输出目录存在（自动递归创建）
    fs.mkdirSync(outputDir, { recursive: true });

    const safeName = sanitizeFilename(filename || `report_${Date.now()}`);
    const filePath = path.join(outputDir, `${safeName}.md`);

    fs.writeFileSync(filePath, content, 'utf-8');

    return `文件已写入: ${filePath}`;
  },
  {
    name: 'writeFile',
    description: '将内容写入磁盘保存为文件。支持写入任意文本内容到指定路径。',
    schema: z.object({
      content: z.string().describe('要写入的文件内容'),
      filename: z.string().optional().describe('文件名（不含扩展名），默认使用时间戳'),
    }),
  },
);
```

- [ ] **Step 2: 验证编译**

```bash
cd F:/codes/commit-log-daily && npx tsc --noEmit
```

期望：仅剩 import 引用 `exportFileTool` 的文件报错（下一步修复）

---

### Task 2: 同步 base.ts 的 import 和工具数组

**Files:**
- Modify: `src/agent/base.ts:8,27`

- [ ] **Step 1: 修改 import 名称**

`src/agent/base.ts` 第 8 行：

```typescript
// 旧
import { exportFileTool } from './tools/exportFile.js';
// 新
import { writeFileTool } from './tools/exportFile.js';
```

- [ ] **Step 2: 修改 GENERATE_TOOLS 数组**

`src/agent/base.ts` 第 25-28 行：

```typescript
// 旧
const GENERATE_TOOLS = [
  generateReportTool,
  exportFileTool,
];
// 新
const GENERATE_TOOLS = [
  generateReportTool,
  writeFileTool,
];
```

- [ ] **Step 3: 验证编译通过**

```bash
cd F:/codes/commit-log-daily && npx tsc --noEmit
```

---

### Task 3: 同步 useSession.ts 的 import 和 toolMap

**Files:**
- Modify: `src/tui/useSession.ts:267,277`

- [ ] **Step 1: 修改 import 名称**

`src/tui/useSession.ts` 第 267 行：

```typescript
// 旧
const { exportFileTool } = await import('../agent/tools/exportFile.js');
// 新
const { writeFileTool } = await import('../agent/tools/exportFile.js');
```

- [ ] **Step 2: 修改 toolMap 键名和引用**

`src/tui/useSession.ts` 第 277 行：

```typescript
// 旧
exportFile: exportFileTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
// 新
writeFile: writeFileTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
```

- [ ] **Step 3: 验证编译通过**

```bash
cd F:/codes/commit-log-daily && npx tsc --noEmit
```

---

### Task 4: 更新 System Prompt 文本

**Files:**
- Modify: `src/agent/prompts/system.ts:50`

- [ ] **Step 1: 修改 GENERATE_SYSTEM_PROMPT**

将 `GENERATE_SYSTEM_PROMPT` 的第 49-50 行替换为：

```typescript
// 旧
4. 生成后主动询问用户：是否需要调整？是否需要导出为文件？
5. 导出时调用 exportFile 工具。`;
// 新
4. 生成后主动询问用户：是否需要调整？是否需要将报告保存为文件？
5. 需要写入文件时调用 writeFile 工具，传入报告内容和文件名即可。`;
```

- [ ] **Step 2: 验证编译通过**

```bash
cd F:/codes/commit-log-daily && npx tsc --noEmit
```

---

### Task 5: 更新 config/store.ts 注释

**Files:**
- Modify: `src/config/store.ts:83`

- [ ] **Step 1: 修改注释**

```typescript
// 旧
/** 导出配置目录路径，供 exportFile 工具使用 */
// 新
/** 导出配置目录路径，供 writeFile 工具使用 */
```

- [ ] **Step 2: 最终编译检查**

```bash
cd F:/codes/commit-log-daily && npx tsc --noEmit
```

---

### Task 6: 构建验证

**Files:** 无（验证步骤）

- [ ] **Step 1: 执行构建确保 dist 产出正确**

```bash
cd F:/codes/commit-log-daily && npm run build
```

- [ ] **Step 2: 全局搜索确认无遗漏的 `exportFile` 引用**

```bash
cd F:/codes/commit-log-daily && rg "exportFile" --include="*.ts" --include="*.tsx" --no-heading | grep -v node_modules | grep -v "docs/"
```

期望结果应只显示 `docs/` 下的旧文档引用和 `exportFile.ts` 文件名本身的 import 路径（`'./tools/exportFile.js'` 是文件名路径，不需要改）。
