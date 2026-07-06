# 会话持久化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 commit-log-daily TUI 增加会话持久化能力——将对话历史保存到本地 SQLite，支持通过 `/history` 命令查看和恢复历史会话。

**Architecture:** 新增 `src/session/` 模块封装 SQLite CRUD 操作；`HistoryView` 负责历史列表交互；`useSession` 负责会话生命周期（创建、保存、恢复）的编排。消息使用 JSON 序列化存储，SystemMessage 不持久化，恢复时重新注入。

**Tech Stack:** better-sqlite3（同步 SQLite）、Node.js crypto.randomUUID()、Ink React

---

## 文件结构

```
src/session/
├── types.ts          ← 新建：SessionSummary、FullSession、StoredMessage 类型
└── store.ts          ← 新建：SQLite CRUD（openDb/createSession/saveMessage/saveContext/listSessions/loadSession/deleteSession）

src/tui/
├── HistoryView.tsx   ← 新建：历史会话列表界面
├── ChatView.tsx      ← 修改：新增 /history 斜杠命令（+1 行）
├── useSession.ts     ← 修改：接入 store（新增 ~60 行）
└── app.tsx           ← 修改：HistoryView 路由（新增 ~15 行）

package.json          ← 修改：新增 better-sqlite3 依赖
```

---

### Task 1: 安装依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 better-sqlite3 及其类型定义**

```bash
cd F:/codes/commit-log-daily && pnpm add better-sqlite3 && pnpm add -D @types/better-sqlite3
```

- [ ] **Step 2: 验证安装**

```bash
cd F:/codes/commit-log-daily && node -e "const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.exec('CREATE TABLE test (id INTEGER)'); console.log('OK'); db.close();"
```

Expected: `OK`

- [ ] **Step 3: 提交**

```bash
cd F:/codes/commit-log-daily && git add package.json pnpm-lock.yaml && git commit -m "chore: 添加 better-sqlite3 依赖"
```

---

### Task 2: 创建 `src/session/types.ts`

**Files:**
- Create: `src/session/types.ts`

- [ ] **Step 1: 写入类型定义文件**

```typescript
import type { SessionContext, AgentPhase } from '../agent/types.js';

/** 会话列表项（不含消息体） */
export interface SessionSummary {
  id: string;
  title: string;
  phase: AgentPhase;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 完整会话（含所有消息） */
export interface FullSession {
  id: string;
  title: string;
  phase: AgentPhase;
  context: SessionContext;
  messages: StoredMessage[];
}

/** 存储的消息结构（持久化格式） */
export interface StoredMessage {
  role: 'human' | 'ai' | 'system' | 'tool';
  content: string | unknown[]; // LangChain content: string 或 ContentBlock 数组
  tool_calls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  tool_call_id?: string;
}
```

- [ ] **Step 2: 验证编译**

```bash
cd F:/codes/commit-log-daily && npx tsc --noEmit
```
Expected: 无错误输出

- [ ] **Step 3: 提交**

```bash
cd F:/codes/commit-log-daily && git add src/session/types.ts && git commit -m "feat: 添加会话持久化类型定义"
```

---

### Task 3: 创建 `src/session/store.ts`

**Files:**
- Create: `src/session/store.ts`

- [ ] **Step 1: 写入 store 实现**

```typescript
import Database from 'better-sqlite3';
import path from 'node:path';
import { CONFIG_DIR } from '../config/store.js';
import type { SessionSummary, FullSession, StoredMessage } from './types.js';
import type { SessionContext, AgentPhase } from '../agent/types.js';

/** 数据库文件路径 */
const DB_PATH = path.join(CONFIG_DIR, 'sessions.db');

/** 数据库单例 */
let db: Database.Database | null = null;

/** 初始化数据库连接并建表 */
export function openDb(): Database.Database {
  if (db) return db;

  db = new Database(DB_PATH);

  // 启用 WAL 模式，支持并发读
  db.pragma('journal_mode = WAL');

  // 启用外键约束
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      phase       TEXT NOT NULL DEFAULT 'collect',
      context     TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role        TEXT NOT NULL,
      content     TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      seq         INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);
  `);

  return db;
}

/** 创建新会话，返回 sessionId */
export function createSession(title: string): string {
  const database = openDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  database
    .prepare(
      `INSERT INTO sessions (id, title, phase, context, created_at, updated_at)
       VALUES (?, ?, 'collect', '{}', ?, ?)`,
    )
    .run(id, title, now, now);

  return id;
}

/** 追加一条消息到会话 */
export function saveMessage(
  sessionId: string,
  role: string,
  content: string,
  seq: number,
): void {
  const database = openDb();
  const now = new Date().toISOString();

  database
    .prepare(
      `INSERT INTO messages (session_id, role, content, created_at, seq)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(sessionId, role, content, now, seq);

  // 更新会话的 updated_at
  database
    .prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`)
    .run(now, sessionId);
}

/** 保存会话上下文和阶段 */
export function saveContext(
  sessionId: string,
  phase: AgentPhase,
  context: SessionContext,
): void {
  const database = openDb();
  const now = new Date().toISOString();

  database
    .prepare(
      `UPDATE sessions SET phase = ?, context = ?, updated_at = ? WHERE id = ?`,
    )
    .run(phase, JSON.stringify(context), now, sessionId);
}

/** 查询会话列表（按 updated_at 倒序） */
export function listSessions(limit = 50): SessionSummary[] {
  const database = openDb();

  const rows = database
    .prepare(
      `SELECT
         s.id,
         s.title,
         s.phase,
         s.created_at AS createdAt,
         s.updated_at AS updatedAt,
         COUNT(m.id) AS messageCount
       FROM sessions s
       LEFT JOIN messages m ON m.session_id = s.id
       GROUP BY s.id
       ORDER BY s.updated_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
      id: string;
      title: string;
      phase: string;
      createdAt: string;
      updatedAt: string;
      messageCount: number;
    }>;

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    phase: row.phase as AgentPhase,
    messageCount: row.messageCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

/** 加载完整会话（含所有消息） */
export function loadSession(sessionId: string): FullSession | null {
  const database = openDb();

  const sessionRow = database
    .prepare(
      `SELECT id, title, phase, context, created_at AS createdAt, updated_at AS updatedAt
       FROM sessions WHERE id = ?`,
    )
    .get(sessionId) as
    | {
        id: string;
        title: string;
        phase: string;
        context: string;
        createdAt: string;
        updatedAt: string;
      }
    | undefined;

  if (!sessionRow) return null;

  let context: SessionContext;
  try {
    context = JSON.parse(sessionRow.context) as SessionContext;
  } catch {
    context = { dateRange: null, projects: [], commits: [], userSupplements: [] };
  }

  const messageRows = database
    .prepare(
      `SELECT role, content FROM messages
       WHERE session_id = ?
       ORDER BY seq`,
    )
    .all(sessionId) as Array<{ role: string; content: string }>;

  const messages: StoredMessage[] = messageRows.map((row) => {
    const parsed: StoredMessage = JSON.parse(row.content) as StoredMessage;
    return { ...parsed, role: parsed.role || (row.role as StoredMessage['role']) };
  });

  return {
    id: sessionRow.id,
    title: sessionRow.title,
    phase: sessionRow.phase as AgentPhase,
    context,
    messages,
  };
}

/** 删除会话及其所有消息（级联删除） */
export function deleteSession(sessionId: string): void {
  const database = openDb();
  database.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
}
```

- [ ] **Step 2: 验证编译**

```bash
cd F:/codes/commit-log-daily && npx tsc --noEmit
```
Expected: 无错误输出

- [ ] **Step 3: 提交**

```bash
cd F:/codes/commit-log-daily && git add src/session/store.ts && git commit -m "feat: 实现 SQLite 会话存储 CRUD"
```

---

### Task 4: 修改 `src/tui/ChatView.tsx` — 新增 `/history` 命令

**Files:**
- Modify: `src/tui/ChatView.tsx`

- [ ] **Step 1: 在斜杠命令列表中添加 `/history`**

在 `SLASH_COMMANDS` 数组中找到：
```typescript
const SLASH_COMMANDS: SlashCommand[] = [
  { name: '/config', description: '打开配置页', action: 'config' },
  { name: '/export', description: '导出报告到文件', action: 'export' },
  { name: '/projects', description: '管理项目列表', action: 'projects' },
  { name: '/quit', description: '退出程序', action: 'quit' },
];
```

替换为：
```typescript
const SLASH_COMMANDS: SlashCommand[] = [
  { name: '/config', description: '打开配置页', action: 'config' },
  { name: '/export', description: '导出报告到文件', action: 'export' },
  { name: '/projects', description: '管理项目列表', action: 'projects' },
  { name: '/history', description: '查看历史会话', action: 'history' },
  { name: '/quit', description: '退出程序', action: 'quit' },
];
```

- [ ] **Step 2: 验证编译**

```bash
cd F:/codes/commit-log-daily && npx tsc --noEmit
```
Expected: 无错误输出

- [ ] **Step 3: 提交**

```bash
cd F:/codes/commit-log-daily && git add src/tui/ChatView.tsx && git commit -m "feat: 新增 /history 斜杠命令"
```

---

### Task 5: 创建 `src/tui/HistoryView.tsx`

**Files:**
- Create: `src/tui/HistoryView.tsx`

- [ ] **Step 1: 写入 HistoryView 组件**

```typescript
import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { listSessions, deleteSession, loadSession } from '../session/store.js';
import type { SessionSummary, FullSession } from '../session/types.js';

interface HistoryViewProps {
  /** 用户选择恢复某个会话 */
  onRestore: (session: FullSession) => void;
  /** 返回聊天界面 */
  onBack: () => void;
}

/** 历史会话列表视图 */
export function HistoryView({ onRestore, onBack }: HistoryViewProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  useEffect(() => {
    setSessions(listSessions());
  }, []);

  useInput((_input, key) => {
    if (key.escape || _input === 'q') {
      onBack();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      setDeleteConfirm(false);
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(sessions.length - 1, prev + 1));
      setDeleteConfirm(false);
      return;
    }

    if (key.return) {
      if (sessions.length === 0) return;
      const full = loadSession(sessions[selectedIndex]!.id);
      if (full) {
        onRestore(full);
      }
      return;
    }

    if (_input === 'd') {
      if (sessions.length === 0) return;
      if (deleteConfirm) {
        // 二次确认后删除
        const sessionId = sessions[selectedIndex]!.id;
        deleteSession(sessionId);
        const updated = listSessions();
        setSessions(updated);
        setSelectedIndex((prev) => Math.min(prev, updated.length - 1));
        setDeleteConfirm(false);
      } else {
        setDeleteConfirm(true);
      }
      return;
    }

    // 任意其他键取消删除确认
    setDeleteConfirm(false);
  });

  const selectedSession = sessions[selectedIndex] ?? null;

  return (
    <Box flexDirection="column" height={24}>
      {/* 标题栏 */}
      <Box
        paddingLeft={1}
        paddingRight={1}
        borderStyle="single"
        borderColor="cyan"
      >
        <Text bold color="cyan">
          commit-log-daily
        </Text>
        <Text dimColor> · 历史会话</Text>
      </Box>

      {/* 列表区域 */}
      <Box flexDirection="column" flexGrow={1} paddingLeft={2} paddingRight={2} paddingTop={1}>
        {sessions.length === 0 && (
          <Box paddingTop={1}>
            <Text dimColor>暂无历史会话</Text>
          </Box>
        )}

        {sessions.map((session, index) => {
          const isSelected = index === selectedIndex;
          const dateStr = session.createdAt.slice(0, 10);
          const pointer = isSelected ? '❯' : ' ';
          const color = isSelected ? 'cyan' : undefined;

          return (
            <Box key={session.id} flexDirection="row">
              <Text color={color}>
                {pointer} {dateStr}
              </Text>
              <Text color={color}>  {session.title}</Text>
              <Text dimColor>  {session.phase}</Text>
              <Text dimColor>  {session.messageCount} 条消息</Text>
            </Box>
          );
        })}
      </Box>

      {/* 底部操作栏 */}
      <Box
        flexDirection="column"
        flexShrink={0}
        paddingLeft={2}
        paddingRight={2}
        paddingBottom={0}
        borderStyle="single"
        borderColor="gray"
      >
        {deleteConfirm && selectedSession ? (
          <Box paddingTop={0}>
            <Text color="red">
              确认删除 "{selectedSession.title}"？再按一次 d 确认，其他键取消
            </Text>
          </Box>
        ) : (
          <Box paddingTop={0}>
            <Text dimColor>Enter 恢复  d 删除  q 返回</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: 验证编译**

```bash
cd F:/codes/commit-log-daily && npx tsc --noEmit
```
Expected: 无错误输出

- [ ] **Step 3: 提交**

```bash
cd F:/codes/commit-log-daily && git add src/tui/HistoryView.tsx && git commit -m "feat: 实现历史会话列表视图"
```

---

### Task 6: 修改 `src/tui/useSession.ts` — 接入 store

**Files:**
- Modify: `src/tui/useSession.ts`

- [ ] **Step 1: 新增消息序列化辅助函数**

在 `useSession` 导出前（`toChatMessage` 函数附近）新增：

```typescript
import type { StoredMessage } from '../session/types.js';
import { createSession, saveMessage, saveContext, loadSession } from '../session/store.js';

/** 将 LangChain BaseMessage 序列化为存储格式 */
function serializeMessage(msg: BaseMessage): string {
  const role = msg.getType() as StoredMessage['role'];
  const stored: StoredMessage = {
    role,
    content: msg.content,
  };

  // AIMessage 可能携带 tool_calls
  const msgAny = msg as unknown as {
    tool_calls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
    tool_call_id?: string;
  };

  if (msgAny.tool_calls) {
    stored.tool_calls = msgAny.tool_calls;
  }
  if (msgAny.tool_call_id) {
    stored.tool_call_id = msgAny.tool_call_id;
  }

  return JSON.stringify(stored);
}

/** 从存储格式还原为 LangChain BaseMessage */
function deserializeMessage(stored: StoredMessage): BaseMessage {
  const msgAny = stored as StoredMessage & {
    tool_calls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
    tool_call_id?: string;
    name?: string;
  };

  switch (stored.role) {
    case 'human':
      return new HumanMessage(stored.content);
    case 'ai':
      if (msgAny.tool_calls && msgAny.tool_calls.length > 0) {
        return new AIMessage({
          content: typeof stored.content === 'string' ? stored.content : '',
          tool_calls: msgAny.tool_calls,
        });
      }
      return new AIMessage(stored.content);
    case 'tool':
      return new ToolMessage({
        content: typeof stored.content === 'string' ? stored.content : JSON.stringify(stored.content),
        tool_call_id: msgAny.tool_call_id ?? 'unknown',
      });
    default:
      return new AIMessage(stored.content);
  }
}
```

- [ ] **Step 2: 修改 `handleSubmit`，在首次发消息时创建会话，响应后保存**

将现有的 `handleSubmit` 回调替换为以下版本：

```typescript
const handleSubmit = useCallback(
  async (text: string) => {
    // 追加用户消息
    const userMsg = new HumanMessage(text);
    const updated: BaseMessage[] = [...langMessages, userMsg];
    setLangMessages(updated);
    setIsWaiting(true);

    try {
      // 计算用户消息的 seq（首次为 0，后续为已有非 system 消息数）
      let userSeq: number;
      if (currentSessionIdRef.current === null) {
        const dateStr = new Date().toISOString().slice(0, 10);
        const title = `${dateStr}-${text.slice(0, 20)}`;
        currentSessionIdRef.current = createSession(title);
        userSeq = 0;
      } else {
        userSeq = langMessages.filter((m) => m.getType() !== 'system').length;
      }
      saveMessage(currentSessionIdRef.current, 'human', serializeMessage(userMsg), userSeq);

      // 工具调用循环（AI 消息从 userSeq + 1 开始编号）
      const MAX_TOOL_ROUNDS = 10;
      let currentMessages: BaseMessage[] = [...updated];
      let lastAiContent = '';
      let msgSeq = userSeq + 1;

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const model = createModelForPhase(phase);
        const aiMsg = await model.invoke(currentMessages);

        const aiMsgAny = aiMsg as unknown as {
          content: string;
          tool_calls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
        };

        if (aiMsgAny.tool_calls && aiMsgAny.tool_calls.length > 0) {
          currentMessages = [...currentMessages, aiMsg];
          // 保存 AI 消息（含 tool_calls）
          saveMessage(currentSessionIdRef.current, 'ai', serializeMessage(aiMsg), msgSeq++);

          for (const tc of aiMsgAny.tool_calls) {
            const result = await executeTool(tc.name, tc.args);
            const toolMsg = new ToolMessage({ content: result, tool_call_id: tc.id });
            currentMessages = [...currentMessages, toolMsg];
            // 保存 Tool 消息
            saveMessage(currentSessionIdRef.current, 'tool', serializeMessage(toolMsg), msgSeq++);
          }
        } else {
          currentMessages = [...currentMessages, aiMsg];
          // 保存最终 AI 文本消息
          saveMessage(currentSessionIdRef.current, 'ai', serializeMessage(aiMsg), msgSeq++);
          lastAiContent = typeof aiMsg.content === 'string' ? aiMsg.content : '';
          break;
        }
      }

      setLangMessages(currentMessages);

      // 保存上下文
      saveContext(currentSessionIdRef.current, phase, contextRef.current);

      // 检查阶段切换
      handlePhaseCheck(lastAiContent, phase, contextRef.current, setPhase);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      setLangMessages((prev: BaseMessage[]) => [
        ...prev,
        new AIMessage(`执行出错: ${errMsg}`),
      ]);
    } finally {
      setIsWaiting(false);
    }
  },
  [langMessages, phase],
);
```

- [ ] **Step 3: 新增 `loadHistorySession` 方法和 `currentSessionIdRef` ref**

在 `useSession` 函数体的顶部区域，`contextRef` 旁边添加：

```typescript
const currentSessionIdRef = useRef<string | null>(null);
```

在 `handleSubmit` 之后，添加 `loadHistorySession`：

```typescript
/** 从历史恢复会话 */
const loadHistorySession = useCallback(
  (sessionId: string) => {
    const full = loadSession(sessionId);
    if (!full) return;

    // 还原消息（不包含 system —— system 消息在下方重新注入）
    const restored: BaseMessage[] = full.messages.map(deserializeMessage);

    // 注入 SystemMessage（欢迎语）
    restored.unshift(new SystemMessage(WELCOME_MESSAGE));

    setLangMessages(restored);
    setPhase(full.phase);
    contextRef.current = full.context;
    currentSessionIdRef.current = full.id;
  },
  [],
);
```

- [ ] **Step 4: 更新 `SessionState` 返回值和接口**

修改 `SessionState` 接口，新增 `loadHistorySession`：

```typescript
interface SessionState {
  messages: ChatMessage[];
  phase: AgentPhase;
  isWaiting: boolean;
  handleSubmit: (text: string) => void;
  loadHistorySession: (sessionId: string) => void;
}
```

修改 return 语句，包含 `loadHistorySession`：

```typescript
return {
  messages: chatMessages,
  phase,
  isWaiting,
  handleSubmit,
  loadHistorySession,
};
```

- [ ] **Step 5: 验证编译**

```bash
cd F:/codes/commit-log-daily && npx tsc --noEmit
```
Expected: 无错误输出

- [ ] **Step 6: 提交**

```bash
cd F:/codes/commit-log-daily && git add src/tui/useSession.ts && git commit -m "feat: useSession 接入会话存储与恢复"
```

---

### Task 7: 修改 `src/tui/app.tsx` — HistoryView 路由

**Files:**
- Modify: `src/tui/app.tsx`

- [ ] **Step 1: 扩展 ViewMode，添加 history 路由**

将现有 `app.tsx` 的内容替换为：

```typescript
import { useState, useCallback } from 'react';
import { render } from 'ink';
import { ChatView } from './ChatView.js';
import { ConfigView } from './ConfigView.js';
import { HistoryView } from './HistoryView.js';
import { useSession } from './useSession.js';
import type { FullSession } from '../session/types.js';

/** 视图模式 */
type ViewMode = 'chat' | 'config' | 'history';

/** TUI 主应用组件 */
function App() {
  const [view, setView] = useState<ViewMode>('chat');
  const { messages, isWaiting, handleSubmit, loadHistorySession } = useSession();

  /** 处理斜杠命令 */
  const handleCommand = useCallback(
    (action: string) => {
      switch (action) {
        case 'config':
          setView('config');
          break;
        case 'history':
          setView('history');
          break;
        case 'quit':
          process.exit(0);
          break;
        case 'export':
          handleSubmit('导出报告到文件');
          break;
        case 'projects':
          handleSubmit('查看当前项目列表');
          break;
      }
    },
    [handleSubmit],
  );

  const handleConfigClose = useCallback(() => {
    setView('chat');
  }, []);

  /** 从历史会话恢复，切换回聊天视图 */
  const handleRestore = useCallback(
    (session: FullSession) => {
      loadHistorySession(session.id);
      setView('chat');
    },
    [loadHistorySession],
  );

  const handleHistoryBack = useCallback(() => {
    setView('chat');
  }, []);

  if (view === 'config') {
    return <ConfigView onClose={handleConfigClose} />;
  }

  if (view === 'history') {
    return <HistoryView onRestore={handleRestore} onBack={handleHistoryBack} />;
  }

  return (
    <ChatView
      messages={messages}
      onSubmit={handleSubmit}
      isWaiting={isWaiting}
      onCommand={handleCommand}
    />
  );
}

/** 启动 TUI Agent 模式 */
export function startAgentTui(): void {
  render(<App />);
}
```

- [ ] **Step 2: 验证编译**

```bash
cd F:/codes/commit-log-daily && npx tsc --noEmit
```
Expected: 无错误输出

- [ ] **Step 3: 提交**

```bash
cd F:/codes/commit-log-daily && git add src/tui/app.tsx && git commit -m "feat: 添加 HistoryView 路由"
```

---

### Task 8: 端到端验证

**验证流程：**

- [ ] **Step 1: 构建项目**

```bash
cd F:/codes/commit-log-daily && npm run build
```
Expected: 无错误输出

- [ ] **Step 2: 启动应用并验证基本流程**

启动 `node bin/commit-log-daily.js`，执行以下场景：

1. 发送一条消息 → 确认 AI 响应正常
2. 输入 `/` → 确认 `/history` 出现在斜杠命令列表中
3. 输入 `/history` → 确认切换到历史会话列表，能看到刚才的会话
4. 按 `Enter` → 确认恢复到聊天视图，消息列表还原
5. 再次 `/history` → 按 `d` 两次 → 确认会话被删除
6. 按 `q` → 确认返回聊天视图

- [ ] **Step 3: 验证消息持久化**

```bash
cd F:/codes/commit-log-daily && node -e "
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const db = new Database(path.join(os.homedir(), '.commit-log-daily', 'sessions.db'));
const sessions = db.prepare('SELECT id, title FROM sessions ORDER BY updated_at DESC LIMIT 5').all();
console.log('会话列表:', JSON.stringify(sessions, null, 2));
if (sessions.length > 0) {
  const msgs = db.prepare('SELECT role, seq FROM messages WHERE session_id = ? ORDER BY seq').all(sessions[0].id);
  console.log('最新会话消息:', JSON.stringify(msgs, null, 2));
}
db.close();
"
```
Expected: 显示会话列表和消息，无报错

- [ ] **Step 4: 提交（如有遗留文件）**

```bash
cd F:/codes/commit-log-daily && git status
```
如有未提交的构建产物等，一并提交。
