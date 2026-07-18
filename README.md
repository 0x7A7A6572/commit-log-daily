# commit-log-daily

从多个 Git 仓库聚合提交记录，生成日报/周报/月报。采用自然语言驱动的 Agent 交互方式，配置好 API 后直接对话即可。

## 安装

```bash
npm install -g commit-log-daily
```

需要 Node.js 18+。

## 快速开始

```bash
# 启动 Agent TUI 交互模式
clogd

# 或者
commit-log-daily
```

进入聊天界面后，像这样和智能体对话：

- "帮我生成本周周报"
- "汇总最近 3 天的工作"
- "我昨天做了哪些事"
- "添加一个项目 /path/to/your/repo"
- "查看当前配置"

首次使用建议先输入 `/config` 配置 API Key 和 Git 作者信息。

### 斜杠命令

在输入框中输入 `/` 弹出命令菜单：

| 命令 | 用途 |
|------|------|
| `/config` | 配置大模型 API、Git 作者、输出目录 |
| `/projects` | 管理项目列表（添加/删除 Git 仓库） |
| `/history` | 查看和恢复历史会话 |
| `/templates` | 管理报告模板（创建/编辑/删除） |
| `/quit` | 退出 |

## AI 配置

本工具需要兼容 OpenAI 的 API。支持环境变量配置：

```bash
# Linux/Mac
export AI_API_KEY=sk-xxx
export AI_BASE_URL=https://api.openai.com
export AI_MODEL=gpt-4.1-mini

# Windows
set AI_API_KEY=sk-xxx
set AI_BASE_URL=https://api.openai.com
set AI_MODEL=gpt-4.1-mini
```

也可在 TUI 中通过 `/config` 命令配置。

## 功能

### 多仓库聚合

管理任意数量的 Git 仓库，支持手动添加和目录扫描导入。智能体会自动选择合适的仓库和时间范围。

### 智能归纳

Agent 不会简单罗列提交，而是：
- 按功能模块归类（核心产出 / 问题修复 / 技术优化）
- 合并同一天同一功能的多次提交
- 用业务语言表述，避免代码流水账
- 支持补充未提交的隐性工作（协助排查、开会讨论等）

### 用户偏好学习

Agent 会记录用户的历史交互偏好，在后续生成中自动应用：
- 记住常用的时间范围、项目筛选和报告格式
- 偏好权重随使用频次自动调整
- 支持 `/templates` 自定义报告模板，一键套用

### 对话摘要压缩

长对话自动压缩为结构化摘要，避免上下文溢出，确保多轮交互的连贯性。

### 报告导出

报告生成后可导出为 Markdown 文件，保存到配置的输出目录。

### 会话持久化

所有对话自动保存到 SQLite，可在 `/history` 中恢复和继续之前的会话。

## 技术栈

- 运行时：Node.js 18+
- TUI：React 19 + Ink 7
- AI：LangChain（兼容 OpenAI API）
- 持久化：sql.js（SQLite WASM，零原生依赖）
