# 多任务会话生命周期设计

> 状态：待审核 | 日期：2026-07-07

## 一、问题

当前 Agent 图是严格单向的：

```
START → collectLLM ⇄ collectTools → generateLLM ⇄ generateTools → END
                 ↓                                    ↓
           [PHASE:generate]                        END
```

一旦 `phase` 变为 `'generate'`，后续所有 `invoke()` 都直接进入 `generateLLM`，只绑定 `writeFileTool` 一个工具。用户在同一会话中无法重新选择项目或时间范围来生成新报告——产生"工具不见了，只能写文件"的体验。

## 二、方案

**图不改，TUI 层接管"任务生命周期"。** 图为单次任务（收集→生成）设计，TUI 层负责在多轮对话中管理多个任务的切换。

### 核心思路

```
用户发消息
  │
  ▼
┌─ useSession.handleSubmit() ───────────────────────────┐
│                                                       │
│  ① 前置：pendingTaskReset？                            │
│     true  → phase='collect', contextRef 清空            │
│     false → 原样                                       │
│                                                       │
│  ② agentGraph.invoke({ messages, phase })             │
│                                                       │
│  ③ 后置：最后一条 AI 消息含 [TASK_COMPLETE]？           │
│     true  → pendingTaskReset = true, strip 标记        │
│     false → 无操作                                     │
└──────────────────────────────────────────────────────┘
```

`pendingTaskReset` 是运行时布尔标记（useRef），不持久化。

### 关键设计决策

**"多任务"是 TUI 层概念，不是图概念。** 图始终是单次任务状态机——只负责从 collect 到 generate 的一次完整执行。TUI 层在每次 `invoke()` 前决定要不要重置状态，图不需要知道"这是第几个任务"。

## 三、改动清单

| 文件 | 改动 | 类型 |
|------|------|:--:|
| `src/agent/graph.ts` | 不动 | — |
| `src/agent/base.ts` | 新增 `hasTaskCompleteMarker()` + `stripTaskCompleteMarker()` | 新增 |
| `src/agent/prompts/system.ts` | collect 加"多轮会话规则"，generate 加"任务完成标记" | 修改 |
| `src/tui/useSession.ts` | 新增 `pendingTaskResetRef` + 前置检测 + 后置检测 | 修改 |

### graph.ts — 不动

当前图已经正确表达了单次任务：`collectLLM → [PHASE:generate] → generateLLM`。不需要任何边或节点的修改。

### base.ts — 新增两个工具函数

与 `stripPhaseMarker`/`hasPhaseMarker` 对称：

```typescript
/** 检测响应中是否包含任务完成标记 */
export function hasTaskCompleteMarker(content: string): boolean {
  return content.includes('[TASK_COMPLETE]');
}

/** 将 [TASK_COMPLETE] 从文本末尾移除 */
export function stripTaskCompleteMarker(content: string): string {
  return content.replace(new RegExp(`\\n?\\[TASK_COMPLETE\\]\\s*$`, 'g'), '').trim();
}
```

### prompts/system.ts — 两处微调

**collect prompt 末尾追加：**

```
【多轮会话规则】
你运行在一个可能跨越多轮对话的会话中。如果当前没有有效的 dateRange/projects/commits
（工具返回的数据即为当前状态），那就意味着这是一个全新的任务起点——
正常走流程收集数据。不要把之前对话中的旧数据当作当前有效数据。
```

**generate prompt 末尾追加：**

```
【任务完成标记】
报告生成完成并保存后，如果用户提出了新的生成需求（换了项目、换了时间范围、
换了报告类型、或明确说"重新生成XX报"），在回复的最末一行输出 [TASK_COMPLETE]。
仅在以下情况使用：
  · 用户明确要求新的生成 → 使用
  · 用户只是闲聊或评价 → 不使用
  · 用户要求修改当前报告（换风格、调整内容）→ 不使用，直接修改即可
```

### useSession.ts — 核心改动

**① 新增 ref：**

```typescript
const pendingTaskResetRef = useRef<boolean>(false);
```

**② handleSubmit 前置检测（入图前）：**

```typescript
let currentPhase = phase;
if (pendingTaskResetRef.current) {
  currentPhase = 'collect';
  contextRef.current = createEmptyContext();
  pendingTaskResetRef.current = false;
}
```

用局部变量 `currentPhase` 而非直接 `setPhase`——React state 更新是异步的，局部变量确保本轮 `invoke()` 立即用新值。

**③ handleSubmit 后置检测（出图后）：**

```typescript
const lastAiContent = /* 从 resultMessages 取最后一条 AI 消息的 content */;
if (typeof lastAiContent === 'string' && lastAiContent.includes('[TASK_COMPLETE]')) {
  pendingTaskResetRef.current = true;
  // 原地 strip 标记，确保存入数据库的文本是干净的
  lastAIContent = stripTaskCompleteMarker(lastAiContent);
}
```

**④ loadHistorySession 恢复时检测：**

```typescript
// 恢复时检查最后一条 AI 消息，保持标记一致性
const lastAi = restored.filter(m => m.getType() === 'ai').pop();
if (lastAi && typeof lastAi.content === 'string' && lastAi.content.includes('[TASK_COMPLETE]')) {
  pendingTaskResetRef.current = true;
}
```

### toChatMessages — 不需要改

标记的 strip 在 `handleSubmit` 检测时原地完成，`toChatMessages` 收到的已是干净内容。存入数据库的也是干净文本。

## 四、完整交互流程

```
用户: "帮我生成 toolssss 的日报"         ← phase='collect'
  图: collectLLM → scanGit → ... → [PHASE:generate]
  图: generateLLM → writeFile → "✅ 已保存"
  出图: 无 [TASK_COMPLETE] → pendingTaskReset=false

用户: "换个风格"                        ← phase='generate'
  图: generateLLM → "✅ 已替换"
  出图: 无 [TASK_COMPLETE]

用户: "重新选项目，生成周报"             ← phase='generate'
  图: generateLLM → "你想选哪些项目？...[TASK_COMPLETE]"
  出图: pendingTaskReset=true

用户: "toolssss 和 FrameX"             ← 前置检测触发，phase 重置为 'collect'
  contextRef 清空，全新收集开始
  图: collectLLM → findGitRepos → scanGit → ...
```

## 五、两条标记的职责对比

| 标记 | 产生阶段 | 检测者 | 作用 |
|------|---------|--------|------|
| `[PHASE:generate]` | collect | 图路由 `routeAfterCollectLLM` | 同一任务内切换阶段 |
| `[TASK_COMPLETE]` | generate | TUI 层 `handleSubmit` | 跨任务重置，为下次 invoke 准备 |

两个标记在不同粒度上工作，不相冲突。

## 六、不持久化 `pendingTaskReset` 的理由

`pendingTaskReset` 是"下次 invoke 前执行的操作"这一意图的表达，不是数据状态。类似 HTTP 的 `302 Found`——它是一次性指令，不是资源属性。持久化它意味着引入"待执行指令队列"的复杂度，对收益不成比例。

唯一需要处理的边界是历史会话恢复：如果恢复时最后一条 AI 消息恰好包含 `[TASK_COMPLETE]`，`loadHistorySession` 中加一行检测即可还原标记。

## 七、自检

- [x] 无 TBD / TODO
- [x] 图结构完全不动
- [x] 范围聚焦，TUI 层 + Prompt，改动量小
- [x] 两条标记职责清晰，不冲突
- [x] 历史会话恢复的边界情况已覆盖
