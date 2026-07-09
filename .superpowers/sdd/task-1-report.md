# Task 1 Report: `src/shared/editor.ts` — 编辑器解析与 spawn

## 做了什么

- 创建 `src/shared/editor.ts`，导出两个函数：
  - `resolveEditor()` — 按 `$EDITOR` → `$VISUAL` → win32: `notepad` / 其他: `nano` 优先级解析编辑器命令
  - `openInEditor(filePath)` — spawn 编辑器打开文件，GUI 编辑器用 `detached:true + stdio:'ignore'` 不阻塞，终端编辑器用 `stdio:'inherit'` 复用终端

- `isGuiEditor()` 内部函数通过预定义 `GUI_EDITORS` 集合判断编辑器类型（涵盖 Windows/macOS/Linux 常见 GUI 编辑器）

- 错误处理：`ENOENT` 错误返回中文提示 `未找到编辑器 "X"，请设置 $EDITOR 环境变量`，其他错误透传

## 测试结果

```bash
pnpm typecheck
# 无错误输出，编译通过
```

## 提交

```
83fba15 feat: 新增编辑器解析与外部 spawn 模块
```

## 关注点

无。代码完全按照 task brief 中的模板实现，类型检查通过。

## Fix Report

**修复日期**: 2026-07-09

**修复内容**:

1. **GUI 编辑器分支缺少 error 事件监听器（重要）**: 在 `openInEditor()` 中，当 `useGui` 为 `true` 时，子进程 spawn 后从未绑定 `error` 事件监听器。如果编辑器二进制文件不存在，Node.js 会抛出未处理的错误导致进程崩溃。修复：在 `child.unref()` 之前添加 `child.on('error', () => {})` 安全吞掉错误（用户会看到编辑器没打开，可以换用其他编辑器）。

2. **移除 ENOENT 死代码**: `try/catch` 中围绕 `spawn()` 的 ENOENT 检查是死代码——在 Node.js 中，`spawn()` 从不同步抛出 ENOENT 错误，该错误通过 `error` 事件异步传递。移除了 `catch` 分支中的 ENOENT 特定检查，将其保留为通用错误处理器。终端编辑器路径的 ENOENT 处理（第 68-77 行）已存在并通过 `error` 事件正常工作。

**测试结果**:

```bash
pnpm typecheck
# 无错误，编译通过
```

