# 对话历史本地化存储 — 设计规格

## 概述

为 commit-log-daily TUI 增加会话持久化能力。用户退出 App 后，对话历史保存在本地 SQLite 数据库中，下次启动可通过 `/history` 命令查看和恢复历史会话。

## 数据模型

### SQLite 表结构

数据库文件：`~/.commit-log-daily/sessions.db`

```sql
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,      -- UUID v7（天然按时间排序）
  title       TEXT NOT NULL,         -- 自动生成，如 "2026-07-05-周报生成"
  phase       TEXT NOT NULL DEFAULT 'collect',
  context     TEXT NOT NULL,         -- JSON: SessionContext（dateRange, projects, commits 等）
  created_at  TEXT NOT NULL,         -- ISO 8601
  updated_at  TEXT NOT NULL          -- ISO 8601
);

CREATE TABLE messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,         -- 'human' | 'ai' | 'system' | 'tool'
  content     TEXT NOT NULL,         -- JSON 序列化的 LangChain 消息对象
  created_at  TEXT NOT NULL,
  seq         INTEGER NOT NULL       -- 消息在会话中的序号
);

CREATE INDEX idx_messages_session ON messages(session_id, seq);
```

### 设计要点

- **会话与消息分表** — 查询历史列表时不加载消息体，避免性能浪费
- **UUID v7** — 时间有序，避免整数自增的分布式问题
- **context 存完整 JSON** — SessionContext 包含 dateRange、projects、commits、userSupplements，恢复时无损还原
- **消息 content 用 JSON** — LangChain 消息结构复杂（AIMessage 含 tool_calls），JSON 序列化保证无损往返
- **ON DELETE CASCADE** — 删除会话自动清除关联消息
- **不持久化 SystemMessage** — system 消息（欢迎语、阶段 prompt）由代码注入，不存入数据库。恢复会话时根据当前 phase 重新注入对应的 system prompt

## 架构

```
src/session/
├── store.ts          ← SQLite CRUD 封装
└── types.ts          ← 类型定义

src/tui/
├── HistoryView.tsx   ← 新增：历史会话列表界面
├── useSession.ts     ← 修改：接入 store，自动保存/恢复
├── ChatView.tsx      ← 修改：新增 /history 斜杠命令
└── app.tsx           ← 修改：加入 HistoryView 路由
```

### 模块职责

| 模块 | 职责 |
|---|---|
| `session/store.ts` | 数据库 CRUD：创建会话、追加消息、查询列表、加载/删除会话 |
| `session/types.ts` | `SessionSummary`（列表项）、`FullSession`（完整会话，含消息数组） |
| `HistoryView.tsx` | Ink 组件，渲染历史列表，处理 ↑↓/Enter/d/q 键盘交互 |
| `useSession.ts` | 会话生命周期管理：首次发消息时创建会话、每次响应后自动保存、/history 恢复时加载 |
| `app.tsx` | ViewMode 扩展 `'history'`，路由到 HistoryView |

## 接口设计

### `session/store.ts` — 核心方法

```typescript
// 数据库初始化（首次调用时自动建表）
openDb(): Database

// 生命周期
createSession(title: string): string           // 返回 sessionId
saveMessage(sessionId, role, content, seq): void
saveContext(sessionId, phase, context): void

// 查询
listSessions(limit?: number): SessionSummary[]  // 按 updated_at 倒序
loadSession(sessionId): FullSession | null
deleteSession(sessionId): void
```

### `useSession.ts` — 新增恢复接口

Hook 返回值扩展一个 `loadHistorySession(id: string)` 方法：

```typescript
interface SessionState {
  messages: ChatMessage[];
  phase: AgentPhase;
  isWaiting: boolean;
  handleSubmit: (text: string) => void;
  loadHistorySession: (sessionId: string) => void;  // 新增
}
```

`loadHistorySession` 内部调用 `store.loadSession(id)`，将返回的 `FullSession` 还原为：
- `langMessages` — 仅恢复 human/ai/tool 消息，不恢复 system（system 由当前 phase 注入）
- `phase` — 设置为会话存储的阶段
- `contextRef.current` — 还原 SessionContext
- `currentSessionId` — 设置为该会话 ID，后续新消息会继续追加到该会话

### 调用时机

| 时机 | 操作 |
|---|---|
| 首次发消息（currentSessionId === null） | `createSession` |
| 每次 LLM 响应完成 | `saveMessage` × N + `saveContext` |
| `/history` 命令 | 切换到 HistoryView → `listSessions` |
| 用户选择某个历史会话 | `loadSession` → 还原 langMessages + phase + contextRef |
| 用户按 `d` 删除 | `deleteSession` |

### 会话标题自动生成

```typescript
// 首次发消息时生成：日期 + 首条用户消息截断
const title = `${dateStr}-${firstUserMessage.slice(0, 20)}`;
// 示例: "2026-07-05-帮我生成本周周报"
```

### 消息序列化

- **存储：** `JSON.stringify(msg.toDict())` — LangChain 内置方法，将 AIMessage（含 tool_calls）无损序列化
- **还原：** 根据 `role` 字段映射到对应消息构造函数：`HumanMessage` / `AIMessage` / `ToolMessage`

## 交互设计

### HistoryView 界面

```
┌─ commit-log-daily · Agent · / 打开命令 · ↑↓ 滚动 · Ctrl+C 退出 ─┐
│                                                                    │
│  历史会话                                         ← q 返回聊天     │
│  ─────────────────────────────────────────────                     │
│                                                                    │
│  ▸ 2026-07-05  周报生成    collect  15 条消息                      │
│    2026-07-04  调试配置    collect   8 条消息                      │
│    2026-07-03  日常开发    generate  22 条消息                     │
│                                                                    │
│  ─────────────────────────────────────────────                     │
│  Enter 恢复  d 删除  q 返回                                       │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### 键盘操作

| 按键 | 行为 |
|---|---|
| `↑` / `↓` | 选择会话 |
| `Enter` | 恢复选中会话 → 切换到 ChatView |
| `d` | 删除选中会话（二次确认：再按一次 `d`） |
| `q` / `Esc` | 返回 ChatView（不影响当前会话） |

### 启动行为

- 启动时默认进入新的 ChatView（不清空当前会话引用）
- 通过 `/history` 命令手动触发恢复

## 依赖

- `better-sqlite3` — 同步 SQLite 绑定，与 Ink React 渲染模型兼容
- `uuid`（v7 生成）— 或使用 `crypto.randomUUID()`（Node 19+）

## 改动清单

| 文件 | 操作 |
|---|---|
| `src/session/types.ts` | 新建 |
| `src/session/store.ts` | 新建 |
| `src/tui/HistoryView.tsx` | 新建 |
| `src/tui/useSession.ts` | 修改：接入 store |
| `src/tui/ChatView.tsx` | 修改：新增 /history 命令 |
| `src/tui/app.tsx` | 修改：HistoryView 路由 |
| `package.json` | 修改：新增 better-sqlite3、uuid 依赖 |
