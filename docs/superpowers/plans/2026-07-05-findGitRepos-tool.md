# findGitRepos 工具实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `findGitRepos` 工具，让 Agent 能扫描指定目录的一级子目录，自动发现 Git 仓库

**Architecture:** 新增一个独立的 LangChain tool，与现有的 `scanGit`/`addProject` 等工具平级。使用 Node.js `fs` 模块做文件系统扫描，纯同步 I/O（目录扫描规模小，不涉及网络）

**Tech Stack:** Node.js fs/path, @langchain/core/tools, zod

---

### Task 1: 创建 findGitRepos 工具

**Files:**
- Create: `src/agent/tools/findGitRepos.ts`

- [ ] **Step 1: 编写工具实现**

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/** findGitRepos 返回的结果项 */
interface FoundRepo {
  name: string;
  path: string;
}

/** 扫描根目录，发现一级子目录中的 Git 仓库 */
function scanGitRepos(rootPath: string): FoundRepo[] {
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });

  const repos: FoundRepo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const fullPath = path.join(rootPath, entry.name);
    const gitDir = path.join(fullPath, '.git');

    try {
      if (fs.existsSync(gitDir)) {
        repos.push({
          name: entry.name,
          path: fullPath,
        });
      }
    } catch {
      // 无读权限时跳过该子目录
    }
  }

  return repos;
}

/** 扫描目录发现 Git 仓库的工具 */
export const findGitReposTool = tool(
  async ({ rootPath }) => {
    // 校验：必须是绝对路径
    if (!path.isAbsolute(rootPath)) {
      return `请提供绝对路径，收到: "${rootPath}"`;
    }

    // 校验：路径必须存在
    if (!fs.existsSync(rootPath)) {
      return `路径不存在: ${rootPath}`;
    }

    // 校验：必须是目录
    const stat = fs.statSync(rootPath);
    if (!stat.isDirectory()) {
      return `路径不是目录: ${rootPath}`;
    }

    const repos = scanGitRepos(rootPath);

    if (repos.length === 0) {
      return `在 ${rootPath} 下未找到 Git 仓库`;
    }

    return JSON.stringify(repos);
  },
  {
    name: 'findGitRepos',
    description:
      '扫描指定根目录下的一级子目录，发现其中包含 .git 的 Git 仓库。返回仓库名称和路径的列表。用于用户提供目录而非具体项目路径时的自动发现。',
    schema: z.object({
      rootPath: z
        .string()
        .describe('要扫描的根目录，必须是绝对路径，如 "f:/codes/"'),
    }),
  },
);
```

- [ ] **Step 2: 类型检查**

```bash
npx -y tsc -p tsconfig.json --noEmit
```

Expected: 无错误输出

- [ ] **Step 3: 验证工具文件语法和导出正确**

```bash
node -e "const m = require('./dist/agent/tools/findGitRepos.js'); console.log('name:', m.findGitReposTool.name); console.log('description:', m.findGitReposTool.description);"
```

Expected:
```
name: findGitRepos
description: 扫描指定根目录下的一级子目录，发现其中包含 .git 的 Git 仓库...
```

---

### Task 2: 注册到 COLLECT_TOOLS

**Files:**
- Modify: `src/agent/base.ts`

- [ ] **Step 1: 导入 findGitReposTool**

在 `src/agent/base.ts` 第 6 行后添加导入：

```typescript
import { findGitReposTool } from './tools/findGitRepos.js';
```

完整修改后的导入区域：

```typescript
import { scanGitTool } from './tools/scanGit.js';
import { listProjectsTool, addProjectTool, removeProjectTool } from './tools/projects.js';
import { getConfigTool, setConfigTool } from './tools/config-tool.js';
import { exportFileTool } from './tools/exportFile.js';
import { generateReportTool } from './tools/generate.js';
import { findGitReposTool } from './tools/findGitRepos.js';
import { COLLECT_SYSTEM_PROMPT, GENERATE_SYSTEM_PROMPT } from './prompts/system.js';
```

- [ ] **Step 2: 将 findGitReposTool 加入 COLLECT_TOOLS 数组**

修改 `COLLECT_TOOLS` 数组：

```typescript
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
```

- [ ] **Step 3: 类型检查**

```bash
npx -y tsc -p tsconfig.json --noEmit
```

Expected: 无错误输出

---

### Task 3: 注册到 executeTool

**Files:**
- Modify: `src/tui/useSession.ts`

- [ ] **Step 1: 在动态导入行中添加 findGitRepos 导入**

修改 `executeTool` 函数中的动态导入区域，在现有导入后添加一行：

```typescript
const { findGitReposTool } = await import('../agent/tools/findGitRepos.js');
```

完整修改后的动态导入区域（第 127-131 行附近）：

```typescript
// 动态导入工具模块（避免循环依赖）
const { scanGitTool } = await import('../agent/tools/scanGit.js');
const { listProjectsTool, addProjectTool, removeProjectTool } = await import('../agent/tools/projects.js');
const { getConfigTool, setConfigTool } = await import('../agent/tools/config-tool.js');
const { exportFileTool } = await import('../agent/tools/exportFile.js');
const { generateReportTool } = await import('../agent/tools/generate.js');
const { findGitReposTool } = await import('../agent/tools/findGitRepos.js');
```

- [ ] **Step 2: 在 toolMap 中注册 findGitRepos 映射**

在 `toolMap` 对象中添加一行：

```typescript
const toolMap: Record<string, { invoke: (args: Record<string, unknown>) => Promise<string> }> = {
  scanGit: scanGitTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
  listProjects: listProjectsTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
  addProject: addProjectTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
  removeProject: removeProjectTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
  getConfig: getConfigTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
  setConfig: setConfigTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
  exportFile: exportFileTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
  generateReport: generateReportTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
  findGitRepos: findGitReposTool as unknown as { invoke: (args: Record<string, unknown>) => Promise<string> },
};
```

- [ ] **Step 3: 类型检查**

```bash
npx -y tsc -p tsconfig.json --noEmit
```

Expected: 无错误输出

---

### Task 4: 更新 System Prompt

**Files:**
- Modify: `src/agent/prompts/system.ts`

- [ ] **Step 1: 在 COLLECT_SYSTEM_PROMPT 中添加 findGitRepos 引导**

修改 `src/agent/prompts/system.ts` 第 5 行开始的 `COLLECT_SYSTEM_PROMPT`：

```typescript
export const COLLECT_SYSTEM_PROMPT = `你是研发效能助手，帮助开发者收集和整理开发活动数据。

你有以下工具可用：
- scanGit: 扫描 Git 仓库的提交记录
- listProjects: 查看已配置的项目
- addProject: 添加项目配置（需要路径）
- removeProject: 删除项目配置
- getConfig: 查看当前配置
- setConfig: 更新配置项
- findGitRepos: 扫描指定目录下的一级子目录，发现 Git 仓库

工作原则：
1. 用户提出生成报告时，先用 getConfig 确认是否有已配置的项目和作者信息。
   若 API Key 为空或作者邮箱为空，引导用户填写。
2. 项目列表为空则引导用户提供项目路径，用 addProject 注册。
   如果用户提供了目录而非具体项目路径（如 "f:/codes/"），请使用 findGitRepos 扫描其中的 Git 仓库。
3. 扫描 Git 数据后评估质量。发现以下问题必须反问用户，不要自行猜测：
   - 提交信息过于简略（如 "update", "fix", "111", "wip"）
   - 分支名无法归类
   - 提交数量异常少（用户可能遗漏了项目）
4. 数据收集完毕后，询问用户是否有未提交代码的隐性工作（帮人排查问题、开会讨论等）。
5. 确认数据完备后，在你回复的最后一行加入 "[PHASE:generate]" 触发报告生成。`;
```

- [ ] **Step 2: 类型检查**

```bash
npx -y tsc -p tsconfig.json --noEmit
```

Expected: 无错误输出

---

### Task 5: 构建并验证端到端

- [ ] **Step 1: 完整构建**

```bash
npx -y tsc -p tsconfig.json
```

Expected: 无错误输出，`dist/agent/tools/findGitRepos.js` 已生成

- [ ] **Step 2: 验证工具在 Agent 中可用 — 手动测试**

```bash
node -e "
const { createModelForPhase } = require('./dist/agent/base.js');
const { HumanMessage, SystemMessage } = require('@langchain/core/messages');

async function test() {
  const model = createModelForPhase('collect');
  const result = await model.invoke([
    new SystemMessage('你是 help agent'),
    new HumanMessage('请扫描 f:/codes/ 下有哪些项目')
  ]);
  console.log('Agent 响应:', result.content);
  if (result.tool_calls?.length > 0) {
    console.log('工具调用:', result.tool_calls.map(t => t.name));
  }
}
test();
"
```

Expected: Agent 调用了 `findGitRepos` 工具（在 `tool_calls` 中可见）

- [ ] **Step 3: 验证 findGitRepos 工具执行正确**

```bash
node -e "
async function test() {
  const { findGitReposTool } = await import('./dist/agent/tools/findGitRepos.js');
  const result = await findGitReposTool.invoke({ rootPath: 'f:/codes/' });
  console.log('扫描结果:', result);
}
test();
"
```

Expected: 返回 JSON 数组，包含 `commit-log-daily` 等项目
