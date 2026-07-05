import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { listSessions, deleteSession, loadSession } from '../session/store.js';
import type { SessionSummary, FullSession } from '../session/types.js';

interface HistoryViewProps {
  /** 用户选择恢复某个会话 */
  onRestore: (session: FullSession) => void;
  /** 返回聊天界面 */
  onBack: () => void;
}

/** 历史会话列表视图 */
export function HistoryView({ onRestore, onBack }: HistoryViewProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  useEffect(() => {
    setSessions(listSessions());
  }, []);

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      if (deleteConfirm) {
        setDeleteConfirm(false);
        return;
      }
      onBack();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      setDeleteConfirm(false);
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(sessions.length - 1, prev + 1));
      setDeleteConfirm(false);
      return;
    }

    if (key.return) {
      if (sessions.length === 0) return;
      if (deleteConfirm) {
        setDeleteConfirm(false);
        return;
      }
      const full = loadSession(sessions[selectedIndex]!.id);
      if (full) {
        onRestore(full);
      }
      return;
    }

    if (input === 'd') {
      if (sessions.length === 0) return;
      if (deleteConfirm) {
        // 二次确认后删除
        const sessionId = sessions[selectedIndex]!.id;
        deleteSession(sessionId);
        const updated = listSessions();
        setSessions(updated);
        setSelectedIndex((prev) => Math.min(prev, updated.length - 1));
        setDeleteConfirm(false);
      } else {
        setDeleteConfirm(true);
      }
      return;
    }

    // 任意其他键取消删除确认
    setDeleteConfirm(false);
  });

  const selectedSession = sessions[selectedIndex] ?? null;

  return (
    <Box flexDirection="column" height={24}>
      {/* 标题栏 */}
      <Box paddingLeft={1} paddingRight={1}>
        <Text bold color="cyan">
          commit-log-daily
        </Text>
        <Text dimColor> · 历史会话 · q 返回</Text>
      </Box>

      {/* 列表区域 */}
      <Box flexDirection="column" flexGrow={1} paddingLeft={2} paddingRight={2} paddingTop={1}>
        {sessions.length === 0 && (
          <Box paddingTop={1}>
            <Text dimColor>暂无历史会话</Text>
          </Box>
        )}

        {sessions.map((session, index) => {
          const isSelected = index === selectedIndex;
          const dateStr = session.createdAt.slice(0, 10);
          const pointer = isSelected ? '▸' : ' ';
          const color = isSelected ? 'cyan' : undefined;

          return (
            <Box key={session.id} flexDirection="row">
              <Text color={color}>
                {pointer} {dateStr}
              </Text>
              <Text color={color}>  {session.title}</Text>
              <Text dimColor>  {session.phase}</Text>
              <Text dimColor>  {session.messageCount} 条消息</Text>
            </Box>
          );
        })}
      </Box>

      {/* 底部操作栏 */}
      <Box flexDirection="column" flexShrink={0} paddingLeft={2} paddingRight={2} paddingBottom={0}>
        {deleteConfirm && selectedSession ? (
          <Box paddingTop={0}>
            <Text color="red">
              确认删除 "{selectedSession.title}"？再按一次 d 确认，其他键取消
            </Text>
          </Box>
        ) : (
          <Box paddingTop={0}>
            <Text dimColor>Enter 恢复  d 删除  q 返回</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
