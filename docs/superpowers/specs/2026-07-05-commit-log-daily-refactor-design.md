# commit-log-daily 重构设计文档

> 状态：待审核 | 日期：2026-07-05

## 一、项目定位

将 `commit-log-daily` 重构为**开发者的日报/周报生成智能体**。通过 TUI 聊天界面，以对话方式引导用户配置项目路径、自动扫描本地 Git 记录、评估数据质量、补充隐性工作，最终生成结构化报告。

## 二、架构方案：双阶段 Agent（方案 C）

### 核心思想

不引入 LangGraph 状态机的 `interrupt()` 机制来管理 Human-in-the-loop，因为 TUI 聊天界面本身已经是轮次式的——Agent 说一句、用户回一句，天然承载反问与补充的交互需求。

工作流分为两个阶段：

1. **收集阶段（collect）**：Agent 带着 Git 扫描工具，理解用户意图 → 收集数据 → 评估质量 → 必要时反问用户补充信息
2. **生成阶段（generate）**：数据完备后，切换到生成模式，套用模板输出报告

阶段切换由 TUI 层的简单状态标记控制，不依赖 LangGraph。工具文件预留了未来升级到方案 A（LangGraph 全状态机）的接口。

### 架构分层

```
┌──────────────────────────────────────────────────┐
│                  TUI 聊天界面 (Ink)                │
│              app.tsx + useSession.ts              │
│         纯 UI 渲染，不管 Git 和 LLM 逻辑          │
└──────────────────────┬───────────────────────────┘
                       │ 依赖
┌──────────────────────▼───────────────────────────┐
│                  Agent 层                         │
│  base.ts          创建 LLM 实例，绑定工具         │
│  session.ts       phase 切换 + 上下文校验         │
│  tools/           工具集（按 phase 分组）          │
│  prompts/         System Prompt + 报告模板        │
└──────────────────────┬───────────────────────────┘
                       │ 依赖
┌──────────────────────▼───────────────────────────┐
│                  配置层                           │
│  store.ts         读写 ~/.commit-log-daily/       │
│  schema.ts        Zod 配置结构验证                │
└──────────────────────────────────────────────────┘
```

依赖方向单向：`tui/ → agent/ → config/`，不可反向。

### 升级到方案 A 的路径

方案 C 的工具文件（`scanGit.ts`、`projects.ts` 等）可直接复用为 LangGraph 节点。届时只需：
- 新增 `agent/nodes/` 目录，每个节点封装一个工具调用
- 新增 `agent/workflow.ts` 组装 StateGraph
- `useSession.ts` 从管理 `phase` 切换改为驱动 LangGraph `invoke`

## 三、关键交互流程

### 一次完整的"生成本周周报"

```
用户: "帮我生成本周周报"
  → Agent 在 collect 阶段
  → 发现无已配置项目 → 反问项目路径
用户: "/Users/me/projA, /Users/me/projB"
  → Agent 调用 addProject 记录
  → Agent 调用 scanGit 获取本周提交
  → 发现 3 条 commit 信息是 "update"
  → 反问: "projA 里有几条提交太简略，具体做了什么？"
用户: "修复了支付回调的退款 bug"
  → Agent 评估数据完备
  → 追问: "还有没有改了一半没提交的、帮人排查问题的、开会的？"
用户: "周三下午帮新人排查了一个数据库死锁"
  → Agent 确认数据完备，回复中附带 [PHASE:generate]
  → TUI 层检测到信号，切换到 generate 阶段
  → Agent 套用模板生成 Markdown 周报
  → 询问: "需要调整或导出文件吗？"
```

### 阶段切换的底线校验

不靠 LLM 判断，靠代码保证三个条件缺一不可：

```typescript
function canTransitionToGenerate(ctx: SessionContext): boolean {
  return (
    ctx.dateRange !== null &&
    ctx.projects.length > 0 &&
    ctx.commits.length > 0
  );
}
```

即使 Agent 回复中带了 `[PHASE:generate]` 信号，校验不通过也不切换。

### SessionContext 数据结构

```typescript
interface SessionContext {
  dateRange: { since: string; until: string } | null;
  projects: { name: string; path: string }[];
  commits: {
    projectName: string;
    hash: string;
    message: string;
    branch: string;
    date: string;
  }[];
  userSupplements: string[];
}
```

## 四、工具设计

| 工具名 | 所属阶段 | 功能 | 安全级别 |
|--------|---------|------|---------|
| `scanGit` | collect | 扫描指定项目的 Git 提交记录（`--all` 跨所有分支） | 只读，白名单 |
| `listProjects` | collect | 列出已配置的项目 | 只读 |
| `addProject` | collect | 添加/更新项目配置 | 写入配置 |
| `removeProject` | collect | 删除项目配置 | 写入配置 |
| `generateReport` | generate | 传入上下文 + 模板，生成报告 | 纯 LLM |
| `exportFile` | generate | 将报告导出为 Markdown 文件 | 写入文件 |
| `getConfig` | collect | 查看当前配置（API Key 脱敏展示） | 只读 |
| `setConfig` | collect | 更新模型、作者、输出目录等配置项 | 写入配置 |

### 安全 Git 执行器

核心原则：**数组传参 + 白名单 + execFile**。

- LLM 传入结构化参数（`projectPath`、`since`、`author` 等），不拼接命令字符串
- 工具内部将参数化为 `['log', '--all', '--format=...', '--since=...']` 数组
- `child_process.execFile('git', args)` 不经过 Shell，LLM 无论填什么都逃不出参数边界
- 子命令白名单：`log`、`branch`、`diff`、`show`、`status`
- 参数黑名单：`rm`、`push`、`reset`、`clean`、`--hard`、`;`、`&&`、`|`、`>`、`<`

### scanGit 工具行为

- 默认带 `--all`，确保查询用户在所有分支上的提交
- 默认带 `--author` 使用配置中的邮箱过滤
- 返回结构化 JSON：`{ commits: [{ hash, author, date, message, branch }] }`

### Git 数据覆盖边界

- ✅ 指定时间范围（`--since` + `--until`）
- ✅ 跨分支（`--all`）
- ✅ 按作者过滤
- ❌ 未 fetch 的远端提交（受限于本地仓库状态）
- ❌ 已被 squash/rebase 掉的提交（Git 自身限制）
- ✅ 未提交的工作由用户在对话中补充（`userSupplements`）

## 五、Prompt 设计

### 收集阶段 System Prompt 要点

- 用户提出生成报告时，先确认是否有已配置的项目，若无则引导提供路径
- 扫描 Git 数据后评估质量，以下情况必须反问用户：
  - 提交信息过于简略（`update`、`fix`、`111` 等）
  - 分支名无法归类
  - 提交数量异常少
- 不自行猜测模糊信息
- 数据收集完毕后询问是否有隐性工作
- 确认完备后回复末尾附加 `[PHASE:generate]`

### 生成阶段 System Prompt 要点

- 切换到报告生成模式，接收完整 commit 列表 + 用户补充 + 报告模板
- 将同一天/同一功能的多次提交合并
- 用业务语言而非代码流水账
- 融入用户补充的隐性工作
- 生成后询问是否需要调整或导出

### 报告模板

```markdown
# {类型} — {日期范围}

## 核心产出
## 问题修复
## 技术优化
## 其他工作
## 下一步计划
```

模板中的 `{类型}` 和 `{日期范围}` 由 Agent 填充。章节映射规则（`feat/ → 核心产出`、`fix/ → 问题修复` 等）写入 System Prompt，后续可单独抽成 `mapping-rules.md`。

## 六、配置设计

### 配置存储

配置文件位于 `~/.commit-log-daily/config.json`，首次运行 Agent 时自动创建。

### 配置结构

```typescript
interface AppConfig {
  /** 大模型配置 */
  model: {
    baseUrl: string;   // OpenAI 兼容 API 地址，默认 "https://api.openai.com"
    model: string;     // 模型名，默认 "gpt-4.1-mini"
    apiKey: string;    // API Key
  };
  /** Git 作者配置，用于 git log --author 过滤 */
  author: {
    name: string;      // git user.name，如 "张三"
    email: string;     // git user.email，如 "zhangsan@example.com"
  };
  /** 已注册的项目列表 */
  projects: {
    name: string;      // 项目别名
    path: string;      // 项目绝对路径
  }[];
  /** 报告配置 */
  report: {
    outputDir: string; // 导出文件默认目录，空字符串表示当前目录
  };
}
```

### 配置来源优先级

三层 fallback，后者覆盖前者：

1. **代码默认值** — `DEFAULT_CONFIG` 中的硬编码值
2. **配置文件** — `~/.commit-log-daily/config.json`
3. **环境变量** — 仅模型配置支持，方便 CI/容器场景

| 配置项 | 环境变量 | 配置键 |
|--------|---------|--------|
| API Key | `AI_API_KEY` | `model.apiKey` |
| Base URL | `AI_BASE_URL` | `model.baseUrl` |
| Model | `AI_MODEL` | `model.model` |

### 首次运行引导

Agent 启动时检查配置是否就绪。以下情况触发引导对话：

| 缺失项 | Agent 行为 |
|--------|-----------|
| 模型 API Key 为空 | 反问"请提供你的 API Key" |
| 模型 Base URL / Model 为空 | 反问并提示默认值 |
| 作者邮箱未配置 | 反问"你的 Git 邮箱是什么？用于过滤你的提交" |
| 项目列表为空 | 在用户首次生成报告时引导添加 |

API Key 写入配置文件前做脱敏处理（仅存储原值，终端回显时屏蔽中间字符）。

### 对话中修改配置

Agent 在 collect 阶段拥有配置管理工具，用户可在对话中随时调整：

```
用户: "换一个模型，用 deepseek"
  → Agent 调用 setModelConfig({ model: "deepseek-chat" })
  → Agent: "模型已切换为 deepseek-chat"

用户: "我换邮箱了，用 new@example.com"
  → Agent 调用 setAuthorEmail({ email: "new@example.com" })
  → Agent: "作者邮箱已更新，下次扫描将使用 new@example.com"
```

为此新增两个工具：

| 工具名 | 功能 |
|--------|------|
| `getConfig` | 查看当前配置（API Key 脱敏展示） |
| `setConfig` | 更新模型、作者、输出目录等配置项 |

### 独立配置页

除对话中维护配置外，提供独立配置页，用户按 `Ctrl+E` 进入。三个配置块以表单形式展示：

```
┌─ 配置 ────────────────────── Esc 返回 ─┐
│                                        │
│  ❯ 大模型                              │
│    Base URL: https://api.openai.com    │
│    Model:    gpt-4.1-mini              │
│    API Key:  sk-****...****x9A         │
│                                        │
│  ❯ Git 作者                            │
│    姓名:  张三                          │
│    邮箱:  zhangsan@example.com         │
│                                        │
│  ❯ 项目列表                            │
│    projA  → /Users/me/projA       [删] │
│    projB  → /Users/me/projB       [删] │
│    [添加项目]                          │
│                                        │
│  [保存]  [取消]                        │
└────────────────────────────────────────┘
```

- **导航**：`↑↓` 切换配置项，`Enter` 进入编辑，`Esc` 退出配置页回到聊天
- **敏感信息**：API Key 编辑时明文输入，展示时始终脱敏（仅显示前 3 位 + 后 3 位）
- **即时校验**：保存时 Zod 校验所有字段，不合法的高亮提示
- **配置即写即生效**：保存后 Agent 立即使用新配置，无需重启
- **项目路径校验**：添加项目时检查路径是否存在且是 Git 仓库

TUI 层视图切换：

```
app.tsx
  ├── ChatView    ← 主视图，对话界面
  └── ConfigView  ← Ctrl+E 进入，Esc 返回
```

### 对话与配置的协作

两个入口互补而非互斥：

| 场景 | 推荐方式 |
|------|---------|
| 首次安装，批量填写配置 | 配置页 |
| 对话中临时调整模型 | 对话（"换 deepseek"） |
| 添加新项目 | 对话（直接给路径）或配置页 |
| 修改 API Key | 配置页（手动输入更自然） |
| 查看当前配置摘要 | 对话（"我当前什么配置"） |

## 七、项目结构

```
commit-log-daily/
├── bin/
│   ├── commit-log-daily.js    # CLI 入口
│   └── agent.js               # Agent TUI 模式入口
├── src/
│   ├── tui/
│   │   ├── app.tsx            # TUI 入口：视图路由（ChatView / ConfigView）
│   │   ├── ChatView.tsx       # 聊天界面（纯 UI）
│   │   ├── useSession.ts      # 会话 hook：消息历史 + phase 切换 + 上下文累积
│   │   └── ConfigView.tsx     # 独立配置页（表单式编辑）
│   ├── agent/
│   │   ├── base.ts            # LLM 实例创建 + 工具绑定
│   │   ├── types.ts           # 共享类型定义
│   │   ├── tools/
│   │   │   ├── scanGit.ts     # Git 安全扫描
│   │   │   ├── projects.ts    # 项目配置增删查
│   │   │   ├── config.ts      # 模型/作者/输出配置读写
│   │   │   ├── generate.ts    # 报告生成
│   │   │   └── exportFile.ts  # Markdown 文件导出
│   │   ├── prompts/
│   │   │   ├── system.ts      # 收集 + 生成阶段的 System Prompt
│   │   │   └── template.md    # 报告生成模板
│   │   └── session.ts         # phase 切换逻辑 + 上下文校验
│   ├── config/
│   │   ├── schema.ts          # Zod 配置结构
│   │   └── store.ts           # ~/.commit-log-daily/config.json 读写
│   └── index.ts               # 导出 startAgentTui()
├── package.json
└── tsconfig.json
```

## 八、工程化

| 项 | 决策 |
|----|------|
| 语言 | TypeScript 5.8 |
| 模块系统 | ESM（`type: "module"` + `"moduleResolution": "NodeNext"`） |
| 编译目标 | ES2022 |
| 编译工具 | `tsc` → `dist/` |
| 严格模式 | `strict: true` |
| JSX | `react-jsx` + `jsxImportSource: "react"`（Ink 需要） |

### 新增依赖

- `langchain` — Agent 核心：tool calling + LLM 交互
- `@langchain/openai` — OpenAI 兼容模型接入

现有依赖（`ink`、`ink-text-input`、`react`、`chalk`、`zod`（通过 langchain 间接引入））保持不变。

### Scripts（保持现有不变）

```json
{
  "build": "tsc -p tsconfig.json",
  "typecheck": "tsc -p tsconfig.json --noEmit",
  "start": "pnpm -s build && node bin/commit-log-daily.js",
  "agent": "pnpm -s build && node bin/agent.js",
  "test": "pnpm -s build && node bin/commit-log-daily.js --help"
}
```

## 九、代码风格

- **注释**：中文，函数/类型使用 JSDoc 说明目的和参数
- **类型**：所有函数显式声明返回类型，变量显式标注，**禁止 `any`**，禁用泛型
- **模块边界**：每个文件单一职责，命名导出，无默认导出
- **命名**：文件 kebab-case，函数 camelCase，类型 PascalCase
- **import**：`node:` 前缀标识核心模块（`import fs from 'node:fs'`）
- **依赖方向**：`tui/ → agent/ → config/`，不可反向
- **文件大小**：单文件 ≤ 800 行，超出则按职责拆分
- **条件分支**：避免长 `if-else` 链，用查表/早返回/策略模式替代
- **错误处理**：自定义错误类，不忽略错误，不做兜底

### 错误类型

```typescript
class GitExecutionError extends Error { /* projectPath + gitArgs 上下文 */ }
class ConfigValidationError extends Error { /* 配置字段路径 */ }
class AgentToolError extends Error { /* 工具名 + 原始错误 */ }
```

## 十、自检

- [x] 无 TBD / TODO
- [x] 架构与功能描述一致
- [x] 范围聚焦，适合单次实施
- [x] 无不明确需求
