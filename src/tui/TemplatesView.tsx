import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import {
  listTemplates,
  readTemplate,
  deleteTemplate as deleteTemplateFn,
  setDefaultTemplate as setDefaultFn,
} from '../template/store.js';

/** 页面模式 */
type Mode = 'list' | 'preview' | 'delete-confirm';

interface TemplatesViewProps {
  onBack: () => void;
}

/**
 * 模板管理独立页面
 * 键盘操作：
 *   ↑↓  导航模板列表
 *   V   预览模板内容
 *   S   设为默认
 *   D   删除选中模板
 *   Esc 返回聊天
 */
export function TemplatesView({ onBack }: TemplatesViewProps) {
  const [templates, setTemplates] = useState(() => listTemplates());
  const [focusIndex, setFocusIndex] = useState<number>(0);
  const [mode, setMode] = useState<Mode>('list');
  const [previewContent, setPreviewContent] = useState<string>('');
  const [statusMsg, setStatusMsg] = useState<string>('');

  const refreshList = () => {
    setTemplates(listTemplates());
  };

  useInput((input, key) => {
    // 预览模式
    if (mode === 'preview') {
      if (key.escape || input === 'b' || input === 'B') {
        setMode('list');
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
      // 预览模板内容
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

    if (key.escape) {
      onBack();
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      {/* 标题栏 */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">
          commit-log-daily · 模板管理
        </Text>
        <Text dimColor>
          ↑↓ 选择  V 预览  S 设为默认  D 删除  Esc 返回
        </Text>
      </Box>

      {/* 预览模式 */}
      {mode === 'preview' && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>模板预览 — {templates[focusIndex]?.filename}</Text>
          <Box marginTop={1} flexDirection="column">
            {previewContent.split('\n').map((line, i) => (
              <Text key={i}>{line || ' '}</Text>
            ))}
          </Box>
          <Box marginTop={1}>
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

      {/* 模板列表 */}
      {mode === 'list' && templates.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor>
            {' '} 暂无模板文件。在 ~/.commit-log-daily/templates/ 下创建 .md
            文件，或通过 Agent 对话创建。
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
                {t.isDefault ? ' ★' : ''}
                {isBuiltin ? ' 🔒' : ''}
              </Text>
            </Box>
          );
        })}

      {/* 状态消息 */}
      {statusMsg && mode === 'list' && (
        <Box marginTop={1}>
          <Text
            color={
              statusMsg.includes('失败') || statusMsg.includes('不可')
                ? 'red'
                : 'green'
            }
          >
            {statusMsg}
          </Text>
        </Box>
      )}

      {/* 底部提示 */}
      <Box marginTop={1}>
        <Text dimColor>
          ★ 默认模板  🔒 内置只读  ·  ~/.commit-log-daily/templates/
        </Text>
      </Box>
    </Box>
  );
}
