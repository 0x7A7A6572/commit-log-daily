# 模板外部编辑器 — 设计文档

**日期**：2026-07-09
**状态**：草稿

## 概述

在 TemplatesView 中增加"打开外部编辑器"能力，让用户可以在熟悉的编辑器（vim/code/nano/notepad）中编辑模板内容，而非在 Ink 终端内做多行文本编辑。

## 编辑器解析策略

链式 fallback，按优先级依次尝试：

```
$EDITOR → $VISUAL → 平台默认
                        ├─ win32 → notepad
                        └─ 其他  → nano
```

- `$EDITOR` / `$VISUAL` 环境变量优先级最高，尊重用户主动设置
- Windows 不设环境变量时 fallback `notepad`（GUI，`spawn` + `detached: true`）
- macOS / Linux 不设时 fallback `nano`（终端编辑器，`spawn` + `stdio: 'inherit'`）

## TemplatesView 改动

### 按键映射（完整）

| 按键 | 适用模式 | 行为 |
|------|---------|------|
| `↑↓` | list | 导航模板列表 |
| `V` | list | 预览选中模板 |
| `E` | list, preview | 打开外部编辑器编辑选中模板 |
| `N` | list | 进入"新建-输文件名"模式 |
| `S` | list | 设为默认模板 |
| `D` | list | 删除选中模板（确认后执行） |
| `R` | list | 手动刷新模板列表 |
| `Esc` / `B` | 各模式 | 返回上一级 / 返回聊天 |

### Mode 状态扩展

```ts
type Mode = 'list' | 'preview' | 'delete-confirm' | 'new-filename';
```

### 新建流程（`N`）

1. 切到 `new-filename` 模式
2. 用 `ink-text-input` 输入模板名（不含 `.md` 扩展名）
3. `Enter` 确认：调用 `createEmptyTemplate(name)` 创建带预制格式的 `.md` 文件 → `openInEditor(path)` → 回到 list 模式
4. `Esc` 取消：回到 list 模式

### 编辑流程（`E`）

1. list 或 preview 模式下，取当前 `focusIndex` 对应的模板
2. 内置 `default` 模板：拒绝，statusMsg 提示"内置模板不可编辑，请新建自定义模板"
3. 自定义模板：`openInEditor(templatePath(name))` → 编辑器进程启动 → 回到 list
4. 用户编辑保存后，按 `R` 刷新列表，按 `V` 预览确认

### 刷新（`R`）

调用 `refreshList()` 重新从文件系统读取模板列表和 preview 内容（若在 preview 模式）。不改变 focusIndex 和 mode。

## 新建预制格式

`createEmptyTemplate(name)` 创建的文件内容：

```markdown
<!-- 以上部分写 Prompt 指令，告诉 LLM 怎么写（风格、人称、约束等） -->

<!-- DATA -->

<!-- 以下部分写 Markdown 骨架，LLM 以此结构生成报告 -->
<!-- 可用占位符：{{reportType}} {{dateRange}} {{author.name}}
     循环：{{#projects}} {{projectName}} {{commitCount}} {{#commits}} {{message}} {{/commits}} {{/projects}} -->

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
<!-- LLM 根据上下文推断 -->
```

## 文件变动清单

### 新增

```
src/shared/
  editor.ts           ← resolveEditor() + openInEditor(filePath)
```

- `resolveEditor()`：按 `$EDITOR` → `$VISUAL` → 平台默认 解析编辑器命令
- `openInEditor(filePath: string)`：`spawn` 进程，GUI 编辑器 `detached: true`，终端编辑器 `stdio: 'inherit'`

### 变更

```
src/template/
  store.ts            ← 新增 createEmptyTemplate(name): void
src/tui/
  TemplatesView.tsx   ← + E/N/R 键绑定 + new-filename 模式 + ink-text-input
```

## 错误与边界处理

| 场景 | 行为 |
|------|------|
| 编辑器不存在（spawn ENOENT） | statusMsg 红字："未找到编辑器 `<cmd>`，请设置 $EDITOR 环境变量" |
| 编辑内置 `default` 模板 | 拒绝，statusMsg："内置模板不可编辑，请新建自定义模板" |
| 新建时文件名为空 | 不创建，statusMsg："模板名不能为空" |
| 新建时文件名已存在 | 不覆盖，statusMsg："模板 `xxx` 已存在，请按 E 编辑" |
| spawn 其他失败 | 捕获错误，statusMsg 显示原因，回 list |
| 编辑器返回后模板文件被手动删除 | 按 R 刷新时自然消失，无需特殊处理 |

## 不在范围内

- Ink 终端内多行编辑（体验差，不做）
- 编辑器进程退出后自动检测文件变更（用户手动按 R 刷新）
- 模板语法/格式校验（和现有设计一致，不校验）
