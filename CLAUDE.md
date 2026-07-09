# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

`commit-log-daily` v2 — 一个 Node.js CLI 工具，聚合多个 Git 仓库的提交记录，智能生成开发者日报/周报/月报。

## 构建与运行

```bash
pnpm build              # TypeScript 编译 → dist/
pnpm typecheck          # 仅类型检查（不产出）
pnpm start              # 编译并启动 TUI
```

本地开发：`pnpm build && node bin/agent.js`（或 `pnpm start`）。

## 架构

### 入口

`bin/agent.js` 是 Agent TUI 入口

### 两层 TUI + Agent 架构

```
bin/agent.js
  └─ src/index.ts → startAgentTui()
       └─ src/tui/app.tsx         ← Ink 渲染根组件，视图路由
            ├─ ChatView           ← 主聊天界面（斜杠命令菜单 + 输入）
            ├─ ConfigView         ← /config 斜杠命令打开，键盘导航编辑配置
            ├─ ProjectsView       ← 项目管理（/projects）
            ├─ HistoryView        ← 历史会话（/history），支持恢复和删除
            ├─ TemplatesView     ← 报告模板管理（/templates），创建/编辑/删除
            └─ useSession.ts      ← 核心 Hook：消息管理、Agent 调用、持久化
```

**视图切换**：App 通过 `useState<ViewMode>` 切换。`/config`/`/history`/`/projects`/`/templates` 斜杠命令切换对应视图。所有视图共用一个真实 Ink `render(<App />)` 实例。

### Agent 两阶段工作流

Agent 分两个阶段，由 `useSession.ts` 中的 Phase 状态和 `src/agent/base.ts` 中的模型绑定控制：

1. **`collect` 阶段**：LLM 可使用所有数据收集工具（scanGit、listProjects、addProject、removeProject、getConfig、setConfig、findGitRepos）收集 Git 提交数据、配置项目和作者信息。
2. **`generate` 阶段**：LLM 仅可使用 generateReport 和 writeFile 工具。基于完整对话上下文生成 Markdown 报告。

**阶段切换**：当 AI 响应包含 `[PHASE:generate]` 标记且三个条件满足（dateRange 非空 + projects 非空 + commits 非空）时，`evaluatePhaseTransition()` 触发切换。切换后下一次 LLM 调用使用 generate 工具集和不同的 System Prompt。

**工具调用循环**：每条用户消息最多执行 10 轮工具调用。每轮依次：调用 LLM → 检查 tool_calls → 执行工具 → 将 AI+Tool 消息追加到运行历史 → 再次调用 LLM。

### 会话持久化

`src/session/store.ts` — SQLite（better-sqlite3），数据库文件 `~/.commit-log-daily/sessions.db`。

- `sessions` 表：id、title、phase、context（SessionContext JSON）、时间戳
- `messages` 表：session_id（外键级联删除）、role、content（StoredMessage JSON）、seq
- `useSession.ts` 中每条用户消息首次进入时自动 `createSession`，后续消息追加到同一会话
- HistoryView 支持列表、恢复、删除

### 配置系统

`src/config/store.ts` — JSON 文件 `~/.commit-log-daily/config.json`，三层：

1. `DEFAULT_CONFIG`（Zod schema 定义的默认值）
2. `config.json` 文件覆盖
3. 环境变量覆盖（`AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL`）

Schema 在 `src/config/schema.ts` 用 Zod 定义：`AppConfig { model, author, projects, report }`。

### Agent 工具

所有工具均基于 `@langchain/core/tools` 的 `tool()` 函数，使用 Zod schema 定义参数：

| 工具 | 阶段 | 用途 |
|------|------|------|
| `scanGit` | collect | 执行 `git log --all`，白名单仅限 `log/branch/diff/show/status`，使用 `execFile` 防注入 |
| `listProjects`/`addProject`/`removeProject` | collect | CRUD 项目配置 |
| `getConfig`/`setConfig` | collect | 读写配置（API Key 脱敏） |
| `findGitRepos` | collect | 扫描目录下的一级子目录发现 Git 仓库 |
| `generateReport` | generate | 生成报告（非直接调用 LLM，返回组装指令） |
| `writeFile` | generate | 将报告写入 `.md` 文件到配置的输出目录 |

### 自定义错误

`src/shared/errors.ts` — `GitExecutionError`（携带 projectPath + gitArgs）、`ConfigValidationError`（携带 fieldPath）、`AgentToolError`（携带 toolName + cause）。

## 技术栈

- **运行时**：Node.js 18+，TypeScript 5.8+（ES2022 目标，NodeNext 模块）
- **TUI**：React 19 + Ink 7 + ink-text-input
- **AI**：LangChain（@langchain/core + @langchain/openai），兼容 OpenAI 的 API
- **持久化**：better-sqlite3（SQLite）+ JSON 配置文件
- **校验**：Zod v4
- **包管理**：pnpm 10

## 关键设计决策

- 配置重新读取：`createModelForPhase()` 每次调用都 `readConfig()`，确保对话中通过 `setConfig` 修改的配置即时生效。
- Git 安全执行：`scanGit.ts` 仅允许白名单子命令，使用 `execFile`（数组传参，不经 Shell）杜绝命令注入。
- 工具执行时 UI 即时反馈：`useSession.ts` 中每轮工具调用先 `setLangMessages` 更新 UI，再执行工具，避免用户无反馈等待。
- 历史恢复时重新注入 SystemMessage：`loadHistorySession()` 在恢复的消息列表前插入新的欢迎语，不依赖数据库中的旧 system 消息。
