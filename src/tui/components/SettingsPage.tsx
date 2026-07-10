import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { VERSION } from '../../version.js';

// ── 类型 ──────────────────────────────────────────────

/** extraKeys handler 的上下文参数 */
interface ExtraKeyContext<T> {
  /** 当前焦点项 */
  focusedItem: T | null;
  /** 焦点下标 */
  focusedIndex: number;
}

/** 列表模式配置 */
interface ListModeConfig<T> {
  /** 列表数据 */
  items: T[];
  /** 渲染单个列表项（isFocused 时通常高亮） */
  renderItem: (item: T, index: number, isFocused: boolean) => React.ReactNode;
  /** 选中回调（Enter 触发） */
  onSelect: (item: T, index: number) => void;
  /** 返回回调（Esc / q 触发） */
  onBack: () => void;
  /** 获取列表项唯一 key */
  getKey: (item: T, index: number) => string;
  /** 搜索配置 — 提供后显示搜索栏 */
  search?: {
    /** 搜索占位符，默认 "搜索…" */
    placeholder?: string;
    /** 过滤函数 */
    filter: (item: T, query: string) => boolean;
  };
  /** 每页显示行数，默认根据终端高度自动计算 */
  pageSize?: number;
  /** 额外按键动作（自定义按键 + 标签 + 处理器，受焦点上下文） */
  extraKeys?: Array<{
    key: string;
    label: string;
    handler: (ctx: ExtraKeyContext<T>) => void;
  }>;
}

interface SettingsPageProps<T = unknown> {
  /** 页面标题 */
  title: string;
  /** 顶部快捷键提示 */
  topHint?: React.ReactNode;
  /** 底部操作/状态信息 */
  bottomHint?: React.ReactNode;
  /** 列表为空时显示的文本 */
  emptyText?: string;
  /** 简单模式 — 内容区域 */
  children?: React.ReactNode;
  /** 列表模式 — 提供后组件接管键盘导航、视口分页和搜索 */
  listMode?: ListModeConfig<T>;
}

// ── 布局常量 ───────────────────────────────────────────

/** 标题栏固定行数（标题 + marginBottom） */
const TITLE_ROWS = 2;
/** 分页信息行 */
const PAGINATION_ROWS = 1;
/** 内容区上下 padding */
const CONTENT_PADDING = 1;

// ── 组件 ───────────────────────────────────────────────

/**
 * 设置页通用布局组件
 *
 * 两种模式：
 * - 简单模式：传入 children，仅提供标题/提示/内容区布局框架
 * - 列表模式：传入 listMode，接管键盘导航、视口分页、搜索过滤
 */
export function SettingsPage<T>({
  title,
  topHint,
  bottomHint,
  emptyText = '暂无数据',
  children,
  listMode,
}: SettingsPageProps<T>) {
  const { stdout } = useStdout();
  const terminalRows = stdout?.rows ?? 24;

  // 列表模式
  if (listMode) {
    return (
      <ListModeView
        title={title}
        topHint={topHint}
        bottomHint={bottomHint}
        emptyText={emptyText}
        config={listMode}
        terminalRows={terminalRows}
      />
    );
  }

  // 简单布局模式
  let chromeRows = TITLE_ROWS + CONTENT_PADDING;
  if (topHint) chromeRows += 1;
  if (bottomHint) chromeRows += 1;

  const contentHeight = Math.max(1, terminalRows - chromeRows);

  return (
    <Box flexDirection="column" height={terminalRows}>
      {/* 标题栏 */}
      <Box flexDirection="column" backgroundColor="white" marginBottom={1}>
        <Text bold color="black">
          · commit-log-daily v{VERSION} · {title}
        </Text>
      </Box>

      {/* 顶部快捷键提示 */}
      {topHint ? <Box>{topHint}</Box> : null}

      {/* 内容区域 */}
      <Box
        flexDirection="column"
        height={contentHeight}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
      >
        {children}
      </Box>

      {/* 底部操作提示 */}
      {bottomHint ? (
        <Box flexDirection="column" flexShrink={0} paddingLeft={2} paddingRight={2}>
          {bottomHint}
        </Box>
      ) : null}
    </Box>
  );
}

// ── 列表模式内部组件 ────────────────────────────────────

type ListModeViewProps<T> = {
  title: string;
  topHint?: React.ReactNode;
  bottomHint?: React.ReactNode;
  emptyText: string;
  config: ListModeConfig<T>;
  terminalRows: number;
};

function ListModeView<T>({
  title,
  topHint,
  bottomHint,
  emptyText,
  config,
  terminalRows,
}: ListModeViewProps<T>) {
  const { items, renderItem, onSelect, onBack, getKey, search, pageSize: propPageSize, extraKeys } = config;
  const hasSearch = !!search;

  // ── 状态 ────────────────────────────────────────
  const [focusIndex, setFocusIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // ── 衍生数据 ────────────────────────────────────
  const filteredItems: T[] = useMemo(() => {
    if (!hasSearch || !searchQuery) return items;
    return items.filter((item) => search!.filter(item, searchQuery));
  }, [items, hasSearch, search, searchQuery]);

  // 计算可视行数
  const pageSize = useMemo(() => {
    if (propPageSize) return propPageSize;
    let chrome = TITLE_ROWS + CONTENT_PADDING + PAGINATION_ROWS;
    if (topHint) chrome += 1;
    if (bottomHint) chrome += 1;
    return Math.max(1, terminalRows - chrome);
  }, [propPageSize, topHint, bottomHint, terminalRows]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const currentPage = scrollOffset > 0 ? Math.floor(scrollOffset / pageSize) + 1 : 1;
  const safeFocus = Math.min(focusIndex, Math.max(0, filteredItems.length - 1));

  // ── 焦点变化时同步滚动 ──────────────────────────
  useEffect(() => {
    setScrollOffset((prev) => syncScroll(safeFocus, prev, pageSize));
  }, [safeFocus, pageSize]);

  // ── 搜索词变化时重置位置 ────────────────────────
  useEffect(() => {
    setFocusIndex(0);
    setScrollOffset(0);
  }, [searchQuery]);

  // ── 数据增删时修正焦点越界 ──────────────────────
  const prevItemsRef = useRef(items);
  useEffect(() => {
    if (prevItemsRef.current !== items) {
      prevItemsRef.current = items;
      setFocusIndex((prev) => Math.min(prev, Math.max(0, items.length - 1)));
    }
  }, [items]);

  // ── 键盘处理 ────────────────────────────────────
  useInput((input, key) => {
    // 搜索模式下 TextInput 捕获输入，useInput 仅处理 Escape
    if (isSearching) {
      if (key.escape) {
        setIsSearching(false);
        setSearchInput('');
      }
      return;
    }

    // Esc：有搜索词则清除，否则返回
    if (key.escape) {
      if (searchQuery) {
        setSearchQuery('');
        setSearchInput('');
        return;
      }
      onBack();
      return;
    }

    // q 等同于 Esc 返回
    if (input === 'q' && !key.ctrl && !key.meta) {
      onBack();
      return;
    }

    // 上下导航
    if (key.upArrow) {
      setFocusIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setFocusIndex((prev) => Math.min(filteredItems.length - 1, prev + 1));
      return;
    }

    // 翻页
    if (key.pageUp) {
      setFocusIndex((prev) => Math.max(0, prev - pageSize));
      return;
    }
    if (key.pageDown) {
      setFocusIndex((prev) => Math.min(filteredItems.length - 1, prev + pageSize));
      return;
    }

    // 选中
    if (key.return) {
      if (filteredItems.length === 0) return;
      const item = filteredItems[safeFocus];
      if (item) onSelect(item, safeFocus);
      return;
    }

    // 额外按键（如 d 删除等自定义动作）
    if (extraKeys) {
      for (const ek of extraKeys) {
        if (input === ek.key && !key.ctrl && !key.meta) {
          ek.handler({
            focusedItem: filteredItems[safeFocus] ?? null,
            focusedIndex: safeFocus,
          });
          return;
        }
      }
    }

    // / 或键入字符进入搜索
    if (hasSearch && ((input === '/' && !key.ctrl && !key.meta) || (input.length === 1 && !key.ctrl && !key.meta && input !== ' '))) {
      setIsSearching(true);
      setSearchInput(input === '/' ? searchQuery : input);
      return;
    }
  });

  // 可视范围内的列表项
  const visibleItems = filteredItems.slice(scrollOffset, scrollOffset + pageSize);

  return (
    <Box flexDirection="column" height={terminalRows}>
      {/* 标题栏 */}
      <Box flexDirection="column" backgroundColor="white" marginBottom={1}>
        <Text bold color="black">
          · commit-log-daily v{VERSION} · {title}
        </Text>
      </Box>

      {/* 顶部快捷键提示 */}
      {topHint ? <Box>{topHint}</Box> : null}

      {/* 内容区域（列表项视口 + 搜索栏） */}
      <Box
        flexDirection="column"
        flexGrow={1}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={0}
      >
        {/* 搜索栏 — 在内容区内，非固定 chrome */}
        {hasSearch && (
          <Box
            borderStyle="round"
            borderColor={isSearching ? 'cyan' : 'grey'}
            paddingLeft={1}
            marginBottom={1}
          >
            <Text dimColor={!isSearching}>⌕ </Text>
            {isSearching ? (
              <TextInput
                value={searchInput}
                onChange={setSearchInput}
                onSubmit={(val) => {
                  setSearchQuery(val.trim());
                  setIsSearching(false);
                }}
                placeholder={search!.placeholder || '搜索…'}
              />
            ) : (
              <Text dimColor>
                {searchQuery || `${search!.placeholder || '搜索…'}  / 搜索`}
              </Text>
            )}
          </Box>
        )}

        {filteredItems.length === 0 ? (
          <Box paddingTop={1}>
            <Text dimColor>{emptyText}</Text>
          </Box>
        ) : (
          visibleItems.map((item, i) => {
            const realIndex = scrollOffset + i;
            const isFocused = realIndex === safeFocus;
            return (
              <Box key={getKey(item, realIndex)}>
                {renderItem(item, realIndex, isFocused)}
              </Box>
            );
          })
        )}
      </Box>

      {/* 分页信息 + 快捷键 */}
      <Box flexShrink={0} paddingLeft={2} paddingRight={2}>
        <Text dimColor>
          共 {filteredItems.length} 条 · 第 {currentPage}/{totalPages} 页
          {hasSearch ? ' · / 搜索' : ''}
        </Text>
        {extraKeys ? extraKeys.map((ek) => (
          <Box key={ek.key} paddingLeft={1}>
            <Text backgroundColor="white" color="black"> {ek.key.toUpperCase()} </Text>
            <Text dimColor> {ek.label}</Text>
          </Box>
        )) : null}
      </Box>

      {/* 底部操作提示 */}
      {bottomHint ? (
        <Box flexShrink={0} paddingLeft={2} paddingRight={2}>
          {bottomHint}
        </Box>
      ) : null}
    </Box>
  );
}

// ── 工具函数 ───────────────────────────────────────────

/** 根据焦点位置计算新的滚动偏移，使焦点保持在可视区内 */
function syncScroll(focusIndex: number, currentScroll: number, pageSize: number): number {
  if (focusIndex < currentScroll) return focusIndex;
  if (focusIndex >= currentScroll + pageSize) return focusIndex - pageSize + 1;
  return currentScroll;
}
