import React, { useState, useRef, useEffect } from "react";
import { Text, Box, useInput } from "ink";
import chalk from "chalk";

// ── 阈值 ──────────────────────────────────────────────

/** 大文本粘贴：超过此行数或字符数则显示摘要 */
const PASTE_LINE_MAX = 3;
const PASTE_CHAR_MAX = 80;

// ── Props ─────────────────────────────────────────────

export interface MultilineTextInputProps {
  /** 当前值（含摘要占位符的显示值） */
  value: string;
  /** 值变更回调 */
  onChange: (value: string) => void;
  /** 提交回调（Enter 触发，Shift+Enter 换行） */
  onSubmit: (value: string) => void;
  /** 占位文本 */
  placeholder?: string;
  /** 是否激活 */
  focus?: boolean;
}

// ── 组件 ──────────────────────────────────────────────

/**
 * 多行文本输入组件
 *
 * 相比 ink-text-input 的增强：
 * - Shift+Enter 换行，Enter 提交
 * - 大文本粘贴自动折叠为摘要（小文本原样展示）
 * - 多行光标追踪与渲染
 */
export function MultilineTextInput({
  value,
  onChange,
  onSubmit,
  placeholder = "",
  focus = true,
}: MultilineTextInputProps) {
  const [cursorOffset, setCursorOffset] = useState(value.length);

  // 选择：用摘要字符串作 key，避免偏移量追踪的复杂度
  // Map<摘要文本, 原始文本>
  const pasteStoreRef = useRef<Map<string, string>>(new Map());

  // 当外部 value 变化时同步光标（确保光标不越界）
  useEffect(() => {
    setCursorOffset((prev) => clamp(prev, 0, value.length));
  }, [value]);

  // ── 输入处理 ──────────────────────────────────────

  useInput(
    (input, key) => {
      // 放行导航键（上层 ChatView 处理斜杠菜单等）
      if (
        key.upArrow ||
        key.downArrow ||
        (key.ctrl && (input === "c" || input === "d")) ||
        key.tab ||
        (key.shift && key.tab) ||
        key.escape
      ) {
        return;
      }

      // Enter：提交（Shift+Enter 换行）
      if (key.return) {
        if (key.shift) {
          applyEdit("\n", cursorOffset, 0);
          return;
        }
        // 提交前还原所有摘要 → 原始文本
        onSubmit(restorePastes(value, pasteStoreRef.current));
        return;
      }

      // 方向键
      if (key.leftArrow) {
        setCursorOffset((prev) => clamp(prev - 1, 0, value.length));
        return;
      }
      if (key.rightArrow) {
        setCursorOffset((prev) => clamp(prev + 1, 0, value.length));
        return;
      }

      // 删除
      if (key.backspace && cursorOffset > 0) {
        applyEdit("", cursorOffset - 1, 1);
        return;
      }
      if (key.delete && cursorOffset < value.length) {
        applyEdit("", cursorOffset, 1);
        return;
      }

      // 文本输入 / 粘贴
      if (input.length > 0) {
        // 知识：Ink 的 useInput 保证：粘贴操作（即便几百行）只回调一次，
        // input 就是完整的粘贴内容（含 \n）
        if (input.length > 1 && isLargePaste(input)) {
          // 大文本 → 插入摘要占位符，原文本存入 pasteStore
          const summary = buildPasteSummary(input);
          pasteStoreRef.current.set(summary, input);
          applyEdit(summary, cursorOffset, 0);
        } else {
          // 小文本 / 单字符 → 直接插入
          applyEdit(input, cursorOffset, 0);
        }
      }
    },
    { isActive: focus },
  );

  /**
   * 统一编辑操作：在 cursorOffset 处删除 delLen 个字符，然后插入 insert。
   * 同时调整 pasteStore 中被删除区域覆盖的条目。
   */
  function applyEdit(insert: string, delStart: number, delLen: number) {
    let nextValue = value;
    let nextCursor = cursorOffset;

    // 先删除
    if (delLen > 0) {
      nextValue = value.slice(0, delStart) + value.slice(delStart + delLen);

      // 清理被删除区域覆盖的 pasteStore 条目
      const deletedSlice = value.slice(delStart, delStart + delLen);
      for (const summary of pasteStoreRef.current.keys()) {
        if (deletedSlice.includes(summary)) {
          pasteStoreRef.current.delete(summary);
        }
      }
      nextCursor = delStart;
    }

    // 再插入
    if (insert.length > 0) {
      nextValue =
        nextValue.slice(0, nextCursor) +
        insert +
        nextValue.slice(nextCursor);
      nextCursor = nextCursor + insert.length;
    }

    setCursorOffset(nextCursor);
    if (nextValue !== value) {
      onChange(nextValue);
    }
  }

  // ── 渲染 ──────────────────────────────────────────

  // 空值时显示占位符
  if (value.length === 0) {
    return (
      <Text dimColor>
        {placeholder || " "}
      </Text>
    );
  }

  const lines = value.split("\n");
  const { cursorRow, cursorCol } = offsetToRowCol(value, cursorOffset);

  return (
    <Box flexDirection="column">
      {lines.map((lineText, lineIdx) => {
        if (lineIdx === cursorRow) {
          // 当前行：渲染光标
          return (
            <Box key={lineIdx}>
              <Text>{renderLineWithCursor(lineText, cursorCol)}</Text>
            </Box>
          );
        }
        return (
          <Box key={lineIdx}>
            <Text>{lineText || " "}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ── 粘贴摘要工具函数 ────────────────────────────────────

/** 判断粘贴内容是否超过阈值 */
function isLargePaste(text: string): boolean {
  const lineCount = text.split("\n").length;
  return lineCount > PASTE_LINE_MAX || text.length > PASTE_CHAR_MAX;
}

/** 构建摘要显示文本 */
function buildPasteSummary(text: string): string {
  const lineCount = text.split("\n").length;
  return `[pasted text ${text.length} chars, ${lineCount} lines]`;
}

/** 提交前还原摘要为原始文本 */
function restorePastes(
  displayValue: string,
  pasteStore: Map<string, string>,
): string {
  if (pasteStore.size === 0) return displayValue;

  let result = displayValue;
  for (const [summary, original] of pasteStore) {
    // 选择：使用 replace 而非 split/join，因为摘要字符串唯一且不会重复
    // 如果摘要已被部分删除导致找不到，则该粘贴块丢失（用户主动编辑的行为）
    if (result.includes(summary)) {
      result = result.replace(summary, original);
    }
  }
  return result;
}

// ── 光标与渲染工具 ─────────────────────────────────────

/** 字符偏移 → (行, 列) */
function offsetToRowCol(
  text: string,
  offset: number,
): { cursorRow: number; cursorCol: number } {
  let row = 0;
  let col = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      row++;
      col = 0;
    } else {
      col++;
    }
  }
  return { cursorRow: row, cursorCol: col };
}

/**
 * 渲染带光标高亮的单行
 *
 * 知识：Ink 的 <Text> 渲染 ANSI 转义序列，
 * chalk.inverse 生成的 ANSI 反色码能被 Ink 正确解析，
 * 这与 ink-text-input 的光标实现完全一致。
 */
function renderLineWithCursor(line: string, cursorCol: number): string {
  if (line.length === 0) {
    // 空行上显示反色空格模拟光标
    return chalk.inverse(" ");
  }

  let result = "";
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    result += i === cursorCol ? chalk.inverse(char) : char;
  }

  // 光标在行尾：追加反色空格
  if (cursorCol >= line.length) {
    result += chalk.inverse(" ");
  }

  return result;
}

/** 限制值在 [min, max] 范围 */
function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
