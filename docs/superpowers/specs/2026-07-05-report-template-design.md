# 用户自定义报告模板 — 设计文档

**日期**：2026-07-05  
**状态**：已批准

## 概述

允许用户通过 `.md` 模板文件自定义日报/周报/月报的格式和风格，替代当前硬编码的报告结构。

## 模板文件

### 存放位置

`~/.commit-log-daily/templates/*.md`

### 文件格式

模板文件由**两段**组成，以 `<!-- DATA -->` 为分隔线：

```markdown
你是研发效能助手。按以下风格生成周报：
- 用第一人称
- 每个条目不超过两行
- 技术细节用"踩坑/方案/收益"三段式描述

<!-- DATA -->

# {{author.name}} 的{{reportType}}

**时间范围**：{{dateRange}}

## 核心产出
{{#projects}}
### {{projectName}}（{{commitCount}} 次提交）
{{#commits}}
- {{message}}
{{/commits}}
{{/projects}}

## 下一步计划
（请在生成时根据上下文推断）
```

- **`<!-- DATA -->` 之上** — Prompt 指令段，注入 System Prompt，指导 LLM 写作行为
- **`<!-- DATA -->` 之下** — Markdown 骨架段，LLM 以此为结构参考生成报告
- 无 `<!-- DATA -->` 分隔线时，整个文件视为骨架
- 占位符（`{{key}}`、`{{#list}}...{{/list}}`）是给 LLM 的结构提示，**不做程序化替换**，LLM 自行理解并填充

### 内置默认模板

`default` 为系统保留模板名，映射到当前硬编码的报告行为（`GENERATE_SYSTEM_PROMPT` + `generateReport` 的 guidelines）。`default` **不可通过工具更新或删除**。

首次使用模板功能时，自动在 `templates/` 目录下生成 `default.md.example` 作为参考文件。

## 配置 Schema 变更

`src/config/schema.ts` — `reportSchema` 新增字段：

```ts
const reportSchema = z.object({
  outputDir: z.string(),
  template: z.string().default('default'),  // 新增
});
```

向后兼容：现有用户的 `config.json` 中 `report` 不含 `template`，Zod `default('default')` 自动补全。

## 生成流程

模板完全通过 **System Prompt** 路径注入，不经过 `generateReport` 工具：

```
用户触发生成
  → useSession 检测到 [PHASE:generate]
  → base.ts: createModelForPhase('generate')
      → 读取 config.report.template
      → resolver.ts: 读取 ~/.commit-log-daily/templates/<name>.md
      → 解析出 promptSection + skeletonSection
      → 构建最终 System Prompt:
          GENERATE_SYSTEM_PROMPT
          + "\n---\n模板指令:\n" + promptSection
          + "\n---\n报告骨架参考:\n" + skeletonSection
      → 绑定 GENERATE_TOOLS（不变）
  → LLM 基于完整上下文生成报告
```

`GENERATE_SYSTEM_PROMPT` 和 `generateReport` 工具 **保持不变**，作为 fallback。

## 工具（6 个，collect 阶段）

| 工具 | 参数 | 说明 |
|------|------|------|
| `listTemplates` | 无 | 列出全部模板文件，返回 `[{filename, isDefault}]` |
| `readTemplate` | `template: string` | 读取指定模板完整内容 |
| `createTemplate` | `template: string`, `content: string` | 新建模板文件 |
| `updateTemplate` | `template: string`, `content: string` | 更新模板（`default` 拒绝） |
| `deleteTemplate` | `template: string` | 删除模板（`default` 拒绝） |
| `setDefaultTemplate` | `template: string` | 设为默认模板，持久化到 `config.report.template` |

典型对话场景：

> 用户："帮我把默认模板的章节改成 本周产出、历史遗留问题修复、下周计划"

→ LLM 调用 `readTemplate("default")` → 无法更新，agent 提示用户 `default` 不可修改，建议 `createTemplate("custom", ...)` 新建模板。

> 用户："我拿到了公司的周报模板，帮我加进去"

→ 用户粘贴内容，LLM 调用 `createTemplate("company", content)`。

## TUI

新增 `/templates` 视图，ViewMode 增加 `'templates'`：

- 列表展示所有模板文件
- 选中预览内容
- 设为默认
- 删除（`default` 不可删除）
- 复用 ConfigView 的键盘导航模式

## 新增/变更文件

### 新增

```
src/template/
  store.ts          ← 模板文件 CRUD（list/read/create/update/delete/setDefault）
  resolver.ts       ← 读取模板文件，解析出 promptSection + skeletonSection
src/agent/tools/
  template-tool.ts  ← 6 个模板工具的 Zod schema + tool() 定义
src/tui/
  TemplatesView.tsx ← 模板管理视图
```

### 变更

```
src/config/schema.ts          ← report.template 字段
src/agent/base.ts             ← createModelForPhase 读取模板拼入 System Prompt
src/agent/prompts/system.ts   ← GENERATE_SYSTEM_PROMPT 保持，作为 fallback
src/tui/app.tsx               ← 路由新增 'templates'
src/agent/types.ts            ← ViewMode 联合类型新增 'templates'
```

## 错误处理

| 场景 | 行为 |
|------|------|
| 模板文件不存在 | 回退 `default`，输出提示"模板 `xxx` 未找到，使用默认格式" |
| 模板文件无 `<!-- DATA -->` | 整个文件视为骨架段，Prompt 段为空字符串 |
| 模板文件编码异常 | 回退 `default` + 报错 |
| `updateTemplate` / `deleteTemplate` 操作 `default` | 拒绝，返回错误信息 |
| `config.report.template` 为空 | Zod default 补全为 `"default"` |

## 不在范围内

- 模板变量引擎（占位符不做程序化替换，全交 LLM 理解）
- 模板导入/导出/分享（手动复制 `.md` 文件即可）
- 模板语法校验（不解析语法，LLM 容错足够）
- `default` 模板的用户自定义（始终映射到内置行为）
