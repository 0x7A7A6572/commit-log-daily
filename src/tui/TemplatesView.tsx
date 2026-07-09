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
