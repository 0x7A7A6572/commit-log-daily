import React, { useState, useCallback } from 'react';
import { Text } from 'ink';
import { listSessions, deleteSession, loadSession } from '../session/store.js';
import type { SessionSummary, FullSession } from '../session/types.js';
import { SettingsPage } from './components/SettingsPage.js';

interface HistoryViewProps {
  /** 用户选择恢复某个会话 */
  onRestore: (session: FullSession) => void;
  /** 返回聊天界面 */
  onBack: () => void;
}

/** 历史会话列表视图 */
export function HistoryView({ onRestore, onBack }: HistoryViewProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>(() => listSessions());
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  /** 删除处理 — 二次确认 */
  const handleDelete = useCallback(
    (ctx: { focusedItem: SessionSummary | null; focusedIndex: number }) => {
      if (!deleteConfirm) {
        setDeleteConfirm(true);
        return;
      }
      // 二次确认后执行删除
      if (ctx.focusedItem) {
        deleteSession(ctx.focusedItem.id);
        setSessions(listSessions());
      }
      setDeleteConfirm(false);
    },
    [deleteConfirm],
  );

  return (
    <SettingsPage<SessionSummary>
      title="历史会话"
      bottomHint={
        deleteConfirm && (
          <Text color="red">确认删除？再按一次 d 确认，其他键取消</Text>
        )
      }
      emptyText="暂无历史会话"
      listMode={{
        items: sessions,
        getKey: (s) => s.id,
        renderItem: (session, _index, isFocused) => {
          const dateStr = session.createdAt.slice(0, 10);
          const pointer = isFocused ? '❯' : ' ';
          const color = isFocused ? 'cyan' : undefined;

          return (
            <Text>
              <Text color={color}>
                {pointer} {dateStr}
              </Text>
              <Text color={color}>  {session.title}</Text>
              <Text dimColor>  {session.phase}</Text>
              <Text dimColor>  {session.messageCount} 条消息</Text>
            </Text>
          );
        },
        onSelect: (session) => {
          const full = loadSession(session.id);
          if (full) onRestore(full);
        },
        onBack,
        search: {
          placeholder: '搜索会话…',
          filter: (session, query) => {
            const q = query.toLowerCase();
            return (
              session.title.toLowerCase().includes(q) ||
              session.createdAt.slice(0, 10).includes(q)
            );
          },
        },
        extraKeys: [
          {
            key: 'd',
            label: '删除',
            handler: handleDelete,
          },
        ],
      }}
    />
  );
}
