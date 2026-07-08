# 多任务会话生命周期 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 TUI 层增加 `[TASK_COMPLETE]` 标记机制，让用户在同一会话中完成一个报告任务后可以自然发起新的收集任务，无需退出会话。

**Architecture:** 不改 LangGraph 图结构。TUI 层 `useSession.ts` 用 `pendingTaskResetRef` 在每次 `invoke()` 前后做"入图前重置 / 出图后检测标记"，`base.ts` 新增标记工具函数，`system.ts` Prompt 微调。图始终保持单次任务语义不变。

**Tech Stack:** TypeScript, React hooks (useRef), LangChain BaseMessage

---

### Task 1: base.ts — 新增 `hasTaskCompleteMarker` 和 `stripTaskCompleteMarker`

**Files:**
- Modify: `src/agent/base.ts`（在 `stripPhaseMarker` 之后追加）

- [ ] **Step 1: 在 `stripPhaseMarker` 定义之后追加两个新函数**

在 `src/agent/base.ts` 第 120 行（`hasPhaseMarker` 结束的 `}` 之后）追加：

```typescript
/** 检测 Agent 响应中是否包含任务完成标记 */
export function hasTaskCompleteMarker(content: string): boolean {
  return content.includes('[TASK_COMPLETE]');
}

/** 将 Agent 原始响应中的 [TASK_COMPLETE] 标记移除，返回清洗后的文本 */
export function stripTaskCompleteMarker(content: string): string {
  return content.replace(new RegExp(`\\n?\\[TASK_COMPLETE\\]\\s*$`, 'g'), '').trim();
}
```

- [ ] **Step 2: TypeScript 编译验证**

```bash
pnpm typecheck
```

预期：通过（新增导出函数，无调用者报错）

- [ ] **Step 3: 提交**

```bash
git add src/agent/base.ts
git commit -m "feat(base): 新增 hasTaskCompleteMarker 和 stripTaskCompleteMarker 工具函数"
```

---

### Task 2: prompts/system.ts — 微调两个阶段的 System Prompt

**Files:**
- Modify: `src/agent/prompts/system.ts`

- [ ] **Step 1: 在 `COLLECT_SYSTEM_PROMPT` 末尾追加多轮会话规则**

在 `COLLECT_SYSTEM_PROMPT` 的末行（\`禁止使用 emoji 和 Markdown 符号\`\` 之后）追加：

```typescript
  · 禁止使用 emoji 和 Markdown 符号

【多轮会话规则】
你运行在一个可能跨越多轮对话的会话中。如果当前没有有效的 dateRange/projects/commits
（工具返回的数据即为当前状态），那就意味着这是一个全新的任务起点——
正常走流程收集数据。不要把之前对话中的旧数据当作当前有效数据。`;
```

具体改动：找到 `COLLECT_SYSTEM_PROMPT` 模板字符串末尾的 `` ` `` 之前，插入上面的 `\n【多轮会话规则】...` 段落。

- [ ] **Step 2: 在 `GENERATE_SYSTEM_PROMPT` 末尾追加任务完成标记规则**

在 `GENERATE_SYSTEM_PROMPT` 的末行（\`写入文件时调 writeFile 工具。\`\` 之后）追加：

```typescript
  写入文件时调 writeFile 工具。

【任务完成标记】
报告生成完成并保存后，如果用户提出了新的生成需求（换了项目、换了时间范围、
换了报告类型、或明确说"重新生成XX报"），在回复的最末一行输出 [TASK_COMPLETE]。
仅在以下情况使用：
  · 用户明确要求新的生成 → 使用
  · 用户只是闲聊或评价 → 不使用
  · 用户要求修改当前报告（换风格、调整内容）→ 不使用，直接修改即可`;
```

具体改动：找到 `GENERATE_SYSTEM_PROMPT` 模板字符串末尾的 `` ` `` 之前，插入上面的 `\n【任务完成标记】...` 段落。

- [ ] **Step 3: TypeScript 编译验证**

```bash
pnpm typecheck
```

预期：通过（仅字符串内容变化）

- [ ] **Step 4: 提交**

```bash
git add src/agent/prompts/system.ts
git commit -m "feat(prompts): collect 加多轮会话规则，generate 加任务完成标记指引"
```

---

### Task 3: useSession.ts — 核心改动：前置重置 + 后置检测 + 历史恢复

**Files:**
- Modify: `src/tui/useSession.ts`

- [ ] **Step 1: 新增 import**

在文件顶部现有 import 区域，追加一行：

```typescript
import { hasTaskCompleteMarker, stripTaskCompleteMarker } from '../agent/base.js';
```

插入位置：放在 `import { createEmptyContext } from '../agent/session.js';` 之后、`import type { SessionContext, AgentPhase } from '../agent/types.js';` 之后都行，与其他 agent 层 import 聚在一起即可。

- [ ] **Step 2: 新增 `pendingTaskResetRef`**

在 `useSession` 函数体内，找到 `const contextRef = useRef<SessionContext>(createEmptyContext());` 这一行（约第 130 行），在其下方新增：

```typescript
const pendingTaskResetRef = useRef<boolean>(false);
```

- [ ] **Step 3: handleSubmit 开头 — 入图前重置检测**

在 `handleSubmit` 的 `useCallback` 函数体内，找到 `setIsWaiting(true);` 这一行（约第 139 行），在其**之前**插入：

```typescript
// 检查是否需要为新任务重置阶段
let currentPhase: AgentPhase = phase;
if (pendingTaskResetRef.current) {
  currentPhase = 'collect';
  contextRef.current = createEmptyContext();
  pendingTaskResetRef.current = false;
}
```

注意 `currentPhase` 是局部变量，不直接调 `setPhase`。

- [ ] **Step 4: 调用图时使用 `currentPhase`**

找到 `agentGraph.invoke(...)` 调用处（约第 176 行），把 `phase: phase` 改为 `phase: currentPhase`：

```typescript
const result = await agentGraph.invoke({
  messages: [...conversationMessages, userMsg],
  phase: currentPhase,
});
```

注意 `conversationMessages` 是在 `langMessages` 基础上过滤的，而 `langMessages` 在函数开头已被 `userMsg` 更新。由于需要用重置后的 `currentPhase` 逻辑，确认这行用的是更新的 `langMessages` 即可（现有代码已是如此）。

- [ ] **Step 5: handleSubmit 末尾 — 出图后检测 `[TASK_COMPLETE]`**

在 `agentGraph.invoke()` 返回后（约第 181 行 `const resultMessages: BaseMessage[] = result.messages;` 之后），找到 `const newPhase: AgentPhase = result.phase;` 之后，持久化循环之前，插入：

```typescript
// 检测任务完成标记，为下一轮重置做准备
const resultAiMessages = resultMessages.filter(
  (m: BaseMessage) => m.getType() === 'ai',
);
const lastAiMsg = resultAiMessages[resultAiMessages.length - 1];
if (lastAiMsg) {
  const aiContent = typeof lastAiMsg.content === 'string' ? lastAiMsg.content : '';
  if (hasTaskCompleteMarker(aiContent)) {
    pendingTaskResetRef.current = true;
    // 原地 strip 标记，确保持久化和 UI 渲染都不带标记
    lastAiMsg.content = stripTaskCompleteMarker(aiContent);
  }
}
```

此段代码插入位置：在 `const newPhase: AgentPhase = result.phase;` 之后、`const newMessages = resultMessages.slice(...)` 之前。

- [ ] **Step 6: loadHistorySession — 恢复时还原标记**

找到 `loadHistorySession` 回调（约第 226 行），在 `contextRef.current = full.context;` 之后、`currentSessionIdRef.current = full.id;` 之前插入：

```typescript
// 检查恢复的会话最后一条 AI 消息是否包含 [TASK_COMPLETE]
const restoredAiMessages = restored.filter(
  (m: BaseMessage) => m.getType() === 'ai',
);
const lastRestoredAi = restoredAiMessages[restoredAiMessages.length - 1];
if (
  lastRestoredAi &&
  typeof lastRestoredAi.content === 'string' &&
  hasTaskCompleteMarker(lastRestoredAi.content)
) {
  pendingTaskResetRef.current = true;
}
```

- [ ] **Step 7: TypeScript 编译 + 构建验证**

```bash
pnpm typecheck
pnpm build
```

预期：typecheck 和 build 均通过。

- [ ] **Step 8: 提交**

```bash
git add src/tui/useSession.ts
git commit -m "feat(tui): 多任务会话生命周期 — pendingTaskReset 前置重置 + [TASK_COMPLETE] 后置检测"
```

---

### Task 4: 端到端验证

**Files:**
- 无新建文件

- [ ] **Step 1: 构建项目**

```bash
pnpm build
```

- [ ] **Step 2: 启动 TUI 并手动验证基础路径**

```bash
pnpm start
```

验证路径 1 — 正常流程不受影响：
1. 输入"帮我生成日报" → 确认 Agent 正常走 collect → generate 流程
2. 输入"换个风格" → 确认仍在 generate 阶段，能重新生成
3. 输入"好，谢谢" → 确认不会出现 `[TASK_COMPLETE]`（闲聊不应触发）

验证路径 2 — 新任务重置：
1. 在上述会话中继续输入"重新选项目，生成 toolssss 的周报"
2. 确认 Agent 检测到新需求并在回复末尾带 `[TASK_COMPLETE]`（或被 strip 后用户看不到）
3. 下一轮输入项目名 → 确认 Agent 回到 collect 模式，能调用 scanGit 等工具

- [ ] **Step 3: 提交（如有微调）**

```bash
git add -A
git commit -m "chore: 端到端验证通过"
```

---

## 改动文件汇总

| 文件 | 改动 |
|------|------|
| `src/agent/graph.ts` | **不动** |
| `src/agent/base.ts` | 新增 2 个导出函数 |
| `src/agent/prompts/system.ts` | 2 处 Prompt 末尾追加 |
| `src/tui/useSession.ts` | 1 个新 ref + 3 处逻辑插入 + 1 个 import |

## 自检

- [x] Spec 覆盖率：所有 4 个文件的改动均有对应 Task
- [x] 无占位符：所有步骤均有完整代码
- [x] 类型一致性：`hasTaskCompleteMarker` / `stripTaskCompleteMarker` 签名在 Task 1 定义，Task 3 引用一致
- [x] 图不动：Task 列表无 graph.ts 修改
