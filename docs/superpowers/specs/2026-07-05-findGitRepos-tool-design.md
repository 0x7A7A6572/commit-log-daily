# findGitRepos 工具设计

> 日期：2026-07-05 | 状态：approved

## 背景

当前 `addProject` 工具要求用户提供精确的项目路径。实际使用中，用户在收集阶段可能会说"f:/codes/ 下的所有项目"——这是一个目录而非具体仓库路径，Agent 无法直接处理，需要自动发现 Git 仓库的能力。

## 目标

新增 `findGitRepos` 工具，让 Agent 能够扫描指定目录下的一级子目录，自动发现其中的 Git 仓库，将结果返回给用户确认后再逐项添加。

## 设计概览

- **工具名**：`findGitRepos`
- **职责**：扫描给定根目录，发现一级子目录中的 Git 仓库
- **不负责**：不自动添加项目（用户确认权保留给 Agent 对话流程）

## 工具定义

```
入参:
  rootPath: string  — 要扫描的根目录，必须是绝对路径

行为:
  1. 校验 rootPath 存在且为目录
  2. 读取该目录下的一级子目录（不递归）
  3. 对每个子目录，检查是否包含 .git 文件夹
  4. 返回 Git 仓库列表

返回（有结果时）:
  JSON: [{ "name": "...", "path": "..." }, ...]

返回（无结果时）:
  字符串: "在 <rootPath> 下未找到 Git 仓库"

错误返回:
  字符串: 路径不存在 / 不是目录 / 不是绝对路径 的具体提示
```

## Schema 定义

```typescript
z.object({
  rootPath: z.string().describe('要扫描的根目录，必须是绝对路径，如 "f:/codes/"'),
})
```

## 涉及文件

| 文件 | 变更 |
|---|---|
| `src/agent/tools/findGitRepos.ts` | **新增** — 工具实现 |
| `src/agent/base.ts` | `COLLECT_TOOLS` 数组中新增 `findGitReposTool` |
| `src/tui/useSession.ts` | `executeTool` 函数中注册 `findGitRepos` 映射 |
| `src/agent/prompts/system.ts` | `COLLECT_SYSTEM_PROMPT` 中加入使用引导 |

## 工作流示例

```
用户: "扫描 f:/codes/ 下的项目"
  → Agent 调 findGitRepos({ rootPath: "f:/codes/" })
  → 返回 [{ "name": "repo-a", "path": "f:/codes/repo-a" }, ...]
  → Agent 展示列表给用户，询问是否添加
  → 用户确认后，Agent 逐个调 addProject
```

## 错误处理

| 场景 | 行为 |
|---|---|
| `rootPath` 不存在 | 返回 `"路径不存在: {rootPath}"` |
| `rootPath` 不是目录 | 返回 `"路径不是目录: {rootPath}"` |
| `rootPath` 不是绝对路径 | 返回 `"请提供绝对路径，收到: {rootPath}"` |
| 子目录无读权限 | 跳过该子目录，继续扫描其他（静默处理） |

## System Prompt 引导

在 `COLLECT_SYSTEM_PROMPT` 中添加：

> 如果用户提供了目录而非具体项目路径（如 "f:/codes/"），请使用 findGitRepos 扫描其中的 Git 仓库。

## 不做什么

- **不递归**：只扫描一级子目录。用户可通过多次调用覆盖更深的目录结构
- **不自动添加**：发现和添加分离，用户始终有确认权
- **不扩展为通用文件查找**：当下只需 Git 仓库发现（YAGNI）
