# 模板外部编辑器 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TemplatesView 支持按 E 键用外部编辑器打开模板、按 N 键新建模板（输入文件名后打开编辑器），按 R 键手动刷新列表。

**Architecture:** 新增 `src/shared/editor.ts` 提供平台无关的编辑器解析和 spawn 逻辑；`src/template/store.ts` 新增 `createEmptyTemplate()` + 导出 `getTemplatePath()`；`src/tui/TemplatesView.tsx` 扩展 Mode 状态和键盘绑定。

**Tech Stack:** Node.js `child_process.spawn`, Ink + ink-text-input, TypeScript

## Global Constraints

- 平台兼容：Windows / macOS / Linux，编辑器按 `$EDITOR` → `$VISUAL` → 平台默认 fallback
- 内置 `default` 模板不可编辑、不可删除（保持不变）
- 所有错误统一通过 `statusMsg` state 展示，成功绿字 / 失败红字
- 编码风格：单引号、分号、4 空格缩进、箭头函数保持现有约定

---

### Task 1: `src/shared/editor.ts` — 编辑器解析与 spawn

**Files:**
- Create: `src/shared/editor.ts`

**Interfaces:**
- Produces: `resolveEditor(): string` — 返回编辑器命令字符串
- Produces: `openInEditor(filePath: string): Promise<void>` — spawn 编辑器进程

- [ ] **Step 1: 创建 `src/shared/editor.ts`**

```typescript
import { spawn } from 'node:child_process';

/**
 * 解析编辑器命令
 * 优先级：$EDITOR → $VISUAL → 平台默认（win32 → notepad, 其他 → nano）
 */
export function resolveEditor(): string {
  const editor = process.env.EDITOR || process.env.VISUAL;
  if (editor) return editor;

  if (process.platform === 'win32') {
    return 'notepad';
  }
  return 'nano';
}

/**
 * GUI 编辑器列表 — 这些编辑器需要 detached: true，不阻塞终端
 */
const GUI_EDITORS = new Set([
  'notepad', 'notepad.exe', 'code', 'code.cmd', 'code.exe',
  'atom', 'subl', 'sublime_text', 'sublime_text.exe',
  'gedit', 'gnome-text-editor',
  'TextEdit', 'open',  // macOS
  'start',              // Windows fallback
]);

/** 判断是否为 GUI 编辑器 */
function isGuiEditor(cmd: string): boolean {
  const base = cmd.split(/[/\\]/).pop()?.toLowerCase() ?? cmd.toLowerCase();
  return GUI_EDITORS.has(base) || GUI_EDITORS.has(cmd.toLowerCase());
}

/**
 * 在外部编辑器中打开文件
 * - GUI 编辑器：detached: true，不阻塞 TUI，fire-and-forget
 * - 终端编辑器（vim/nano）：stdio: 'inherit'，复用当前终端
 *
 * @returns Promise，终端编辑器等待进程退出后 resolve，GUI 编辑器立即 resolve
 */
export function openInEditor(filePath: string): Promise<void> {
  const editorCmd = resolveEditor();

  return new Promise((resolve, reject) => {
    try {
      const useGui = isGuiEditor(editorCmd);

      const child = spawn(editorCmd, [filePath], {
        detached: useGui,
        stdio: useGui ? 'ignore' : 'inherit',
        shell: process.platform === 'win32',
      });

      if (useGui) {
        // GUI 编辑器 — 不等待，立即 resolve
        child.unref();
        resolve();
      } else {
        // 终端编辑器 — 等待进程退出
        child.on('close', (code) => {
          if (code !== null && code !== 0) {
            reject(new Error(`编辑器异常退出 (exit ${code})`));
          } else {
            resolve();
          }
        });

        child.on('error', (err) => {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') {
            reject(
              new Error(`未找到编辑器 "${editorCmd}"，请设置 $EDITOR 环境变量`),
            );
          } else {
            reject(new Error(`启动编辑器失败: ${err.message}`));
          }
        });
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        reject(
          new Error(`未找到编辑器 "${editorCmd}"，请设置 $EDITOR 环境变量`),
        );
      } else {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    }
  });
}
```

- [ ] **Step 2: 编译验证**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/editor.ts
git commit -m "feat: 新增编辑器解析与外部 spawn 模块"
```

---

### Task 2: `src/template/store.ts` — `createEmptyTemplate` + 导出 `getTemplatePath`

**Files:**
- Modify: `src/template/store.ts`

**Interfaces:**
- Produces: `createEmptyTemplate(name: string): void` — 创建含预制注释和骨架的 .md 模板文件
- Produces: `getTemplatePath(name: string): string` — 导出原 module-private 的 `templatePath`
- Consumes: 现有 `ensureDir()`, `TEMPLATE_DIR`, `BUILTIN_TEMPLATE`

- [ ] **Step 1: 在 `store.ts` 底部新增 `createEmptyTemplate` 函数**

在 `src/template/store.ts` 文件末尾（`export { TEMPLATE_DIR };` 之前）追加：

```typescript
/** 新建模板文件时写入的预制内容 */
const NEW_TEMPLATE_CONTENT = `<!-- 以上部分写 Prompt 指令，告诉 LLM 怎么写（风格、人称、约束等） -->

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
`;

/** 创建带预制格式的空白模板文件 */
export function createEmptyTemplate(name: string): void {
  if (name === BUILTIN_TEMPLATE) {
    throw new Error(`"${BUILTIN_TEMPLATE}" 是内置模板，不可创建`);
  }

  ensureDir();
  const filePath = templatePath(name);

  if (fs.existsSync(filePath)) {
    throw new Error(`模板 "${name}" 已存在，请按 E 编辑`);
  }

  fs.writeFileSync(filePath, NEW_TEMPLATE_CONTENT, 'utf-8');
}
```

- [ ] **Step 2: 将 `templatePath` 导出为 `getTemplatePath`**

找到现有的 `function templatePath(name: string): string {`，在其下方新增一行导出别名：

```typescript
function templatePath(name: string): string {
  return path.join(TEMPLATE_DIR, `${name}.md`);
}

/** 获取模板文件的完整路径 */
export const getTemplatePath = templatePath;
```

这一行加在 `templatePath` 函数定义之后即可。

- [ ] **Step 3: 编译验证**

```bash
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/template/store.ts
git commit -m "feat: 新增 createEmptyTemplate + 导出 getTemplatePath"
```

---

### Task 3: `src/tui/TemplatesView.tsx` — E/N/R 键绑定 + new-filename 模式

**Files:**
- Modify: `src/tui/TemplatesView.tsx`

**Interfaces:**
- Consumes: `openInEditor(filePath: string)` from `../shared/editor.js`
- Consumes: `createEmptyTemplate(name: string)`, `getTemplatePath(name: string)` from `../template/store.js`
- Produces: `TemplatesView` 组件新增 E/N/R 键盘绑定和 new-filename 输入模式

- [ ] **Step 1: 完整重写 `src/tui/TemplatesView.tsx`**

```typescript
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import {
  listTemplates,
  readTemplate,
  deleteTemplate as deleteTemplateFn,
  setDefaultTemplate as setDefaultFn,
  createEmptyTemplate,
  getTemplatePath,
} from '../template/store.js';
import { openInEditor } from '../shared/editor.js';

/** 页面模式 */
type Mode = 'list' | 'preview' | 'delete-confirm' | 'new-filename';

interface TemplatesViewProps {
  onBack: () => void;
}

/**
 * 模板管理独立页面
 * 键盘操作：
 *   ↑↓  导航模板列表
 *   V   预览模板内容
 *   E   打开外部编辑器编辑选中模板（内置 default 不可编辑）
 *   N   新建模板（输入文件名后打开外部编辑器）
 *   S   设为默认
 *   D   删除选中模板
 *   R   手动刷新列表
 *   Esc 返回聊天 / 上一级
 *   B   从预览返回列表
 */
export function TemplatesView({ onBack }: TemplatesViewProps) {
  const [templates, setTemplates] = useState(() => listTemplates());
  const [focusIndex, setFocusIndex] = useState<number>(0);
  const [mode, setMode] = useState<Mode>('list');
  const [previewContent, setPreviewContent] = useState<string>('');
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [newFilename, setNewFilename] = useState<string>('');

  const refreshList = () => {
    setTemplates(listTemplates());
  };

  /** 打开外部编辑器编辑当前选中模板 */
  const handleEdit = () => {
    const tmpl = templates[focusIndex];
    if (!tmpl) return;

    if (tmpl.filename === 'default') {
      setStatusMsg('内置模板不可编辑，请新建自定义模板');
      return;
    }

    const filePath = getTemplatePath(tmpl.filename);
    openInEditor(filePath)
      .then(() => {
        setStatusMsg('编辑完成，请按 R 刷新列表');
      })
      .catch((err: unknown) => {
        setStatusMsg(
          `编辑失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  };

  /** 新建模板：确认文件名后创建并打开编辑器 */
  const handleNewSubmit = (value: string) => {
    const trimmed = value.trim();

    if (!trimmed) {
      setStatusMsg('模板名不能为空');
      setMode('list');
      return;
    }

    if (trimmed === 'default') {
      setStatusMsg('"default" 是内置模板名，请使用其他名称');
      setMode('list');
      return;
    }

    try {
      createEmptyTemplate(trimmed);
    } catch (err) {
      setStatusMsg(
        `创建失败: ${err instanceof Error ? err.message : String(err)}`,
      );
      setMode('list');
      return;
    }

    refreshList();
    setStatusMsg('');
    setMode('list');

    // 打开编辑器
    const filePath = getTemplatePath(trimmed);
    openInEditor(filePath)
      .then(() => {
        setStatusMsg(`模板 "${trimmed}" 已创建，编辑完成请按 R 刷新`);
      })
      .catch((err: unknown) => {
        setStatusMsg(
          `编辑器启动失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  };

  useInput((input, key) => {
    // 新建文件名输入模式 — TextInput 处理输入，useInput 仅处理 Escape
    if (mode === 'new-filename') {
      if (key.escape) {
        setMode('list');
        setNewFilename('');
        setStatusMsg('');
        return;
      }
      return;
    }

    // 预览模式
    if (mode === 'preview') {
      if (key.escape || input === 'b' || input === 'B') {
        setMode('list');
        return;
      }
      if (input === 'e' || input === 'E') {
        handleEdit();
        return;
      }
      return;
    }

    // 删除确认模式
    if (mode === 'delete-confirm') {
      if (input === 'y' || input === 'Y') {
        const tmpl = templates[focusIndex];
        if (tmpl) {
          try {
            deleteTemplateFn(tmpl.filename);
            setStatusMsg(`模板 "${tmpl.filename}" 已删除`);
            refreshList();
            if (focusIndex >= templates.length - 1 && templates.length > 1) {
              setFocusIndex(templates.length - 2);
            }
          } catch (err) {
            setStatusMsg(`删除失败: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        setMode('list');
        return;
      }
      if (input === 'n' || input === 'N' || key.escape) {
        setMode('list');
        return;
      }
      return;
    }

    // 列表模式
    if (key.upArrow) {
      setFocusIndex((prev) => (prev - 1 + Math.max(templates.length, 1)) % Math.max(templates.length, 1));
      return;
    }

    if (key.downArrow) {
      setFocusIndex((prev) => (prev + 1) % Math.max(templates.length, 1));
      return;
    }

    if (input === 'v' || input === 'V') {
      const tmpl = templates[focusIndex];
      if (!tmpl) return;
      try {
        const content = readTemplate(tmpl.filename);
        setPreviewContent(
          content || '(内置默认模板 — 核心产出、问题修复、技术优化、其他工作、下一步计划)',
        );
        setMode('preview');
        setStatusMsg('');
      } catch (err) {
        setStatusMsg(`预览失败: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (input === 'e' || input === 'E') {
      handleEdit();
      return;
    }

    if (input === 'n' || input === 'N') {
      setNewFilename('');
      setMode('new-filename');
      setStatusMsg('');
      return;
    }

    if (input === 'd' || input === 'D') {
      const tmpl = templates[focusIndex];
      if (!tmpl) return;
      if (tmpl.filename === 'default') {
        setStatusMsg('内置 default 模板不可删除');
        return;
      }
      setMode('delete-confirm');
      setStatusMsg('');
      return;
    }

    if (input === 's' || input === 'S') {
      const tmpl = templates[focusIndex];
      if (!tmpl) return;
      try {
        setDefaultFn(tmpl.filename);
        setStatusMsg(`已将默认模板设为 "${tmpl.filename}"`);
        refreshList();
      } catch (err) {
        setStatusMsg(`设置失败: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (input === 'r' || input === 'R') {
      refreshList();
      setStatusMsg('列表已刷新');
      return;
    }

    if (key.escape) {
      onBack();
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      {/* 标题栏 */}
      <Box flexDirection="column" backgroundColor="white" marginBottom={1}>
        <Text bold color="black">
          · commit-log-daily · 模板管理
        </Text>
      </Box>
      <Text dimColor>
        ↑↓ 选择  V 预览  E 编辑  N 新建  S 设为默认  D 删除  R 刷新  Esc 返回
      </Text>

      {/* 预览模式 */}
      {mode === 'preview' && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>模板预览 — {templates[focusIndex]?.filename}</Text>
          <Box marginTop={1} flexDirection="column">
            {previewContent.split('\n').map((line, i) => (
              <Text key={i}>{line || ' '}</Text>
            ))}
          </Box>
          <Box marginTop={1} flexDirection="row" gap={1}>
            <Text dimColor>E 编辑</Text>
            <Text dimColor>|</Text>
            <Text dimColor>B 或 Esc 返回列表</Text>
          </Box>
        </Box>
      )}

      {/* 删除确认 */}
      {mode === 'delete-confirm' && templates[focusIndex] && (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">
            确认删除模板 &quot;{templates[focusIndex]!.filename}&quot;？
          </Text>
          <Text dimColor>Y 确认 / N 或 Esc 取消</Text>
        </Box>
      )}

      {/* 新建文件名输入 */}
      {mode === 'new-filename' && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>新建模板 — 输入文件名（不含 .md 扩展名）：</Text>
          <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingLeft={1}>
            <TextInput
              value={newFilename}
              onChange={setNewFilename}
              onSubmit={handleNewSubmit}
              placeholder=" 输入模板名…"
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Enter 确认 / Esc 取消</Text>
          </Box>
        </Box>
      )}

      {/* 模板列表 */}
      {mode === 'list' && templates.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor>
            {' '} 暂无模板文件。按 N 新建，或在 ~/.commit-log-daily/templates/ 下创建 .md 文件。
          </Text>
        </Box>
      )}

      {mode === 'list' &&
        templates.map((t, i) => {
          const isFocused = i === focusIndex;
          const pointer = isFocused ? '❯' : ' ';
          const color = isFocused ? 'cyan' : undefined;
          const isBuiltin = t.filename === 'default';

          return (
            <Box key={t.filename}>
              <Text color={color}>
                {pointer} {t.filename}
                {t.isDefault ? ' [当前]' : ''}
              </Text>
              {isBuiltin && (
                <Box marginLeft={1} paddingX={1} backgroundColor={'white'}>
                  <Text color={'black'}>内置</Text>
                </Box>
              )}
            </Box>
          );
        })}

      {/* 状态消息 */}
      {statusMsg && mode !== 'delete-confirm' && (
        <Box marginTop={1}>
          <Text
            color={
              statusMsg.includes('失败') ||
              statusMsg.includes('不可') ||
              statusMsg.includes('不能')
                ? 'red'
                : 'green'
            }
          >
            {statusMsg}
          </Text>
        </Box>
      )}
    </Box>
  );
}
```

- [ ] **Step 2: 编译验证**

```bash
pnpm typecheck
```

- [ ] **Step 3: 构建验证**

```bash
pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add src/tui/TemplatesView.tsx
git commit -m "feat: TemplatesView 新增 E 编辑/N 新建/R 刷新 + 外部编辑器集成"
```
