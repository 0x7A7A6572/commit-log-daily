import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

/** 聊天消息类型 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** 斜杠命令定义 */
interface SlashCommand {
  name: string;
  description: string;
  action: string;
}

/** 可用命令列表 */
const SLASH_COMMANDS: SlashCommand[] = [
  { name: '/config', description: '打开配置页', action: 'config' },
  { name: '/projects', description: '管理项目列表', action: 'projects' },
  { name: '/history', description: '查看历史会话', action: 'history' },
  { name: '/quit', description: '退出程序', action: 'quit' },
];

/** 菜单最多可见条数 */
const MENU_VISIBLE_MAX = 5;

/** 命令名列宽（最长的命令名 + 2 空格） */
const CMD_NAME_WIDTH = Math.max(...SLASH_COMMANDS.map((c) => c.name.length)) + 2;

interface ChatViewProps {
  /** 当前消息列表 */
  messages: ChatMessage[];
  /** 用户提交消息的回调 */
  onSubmit: (text: string) => void;
  /** 是否正在等待 Agent 响应 */
  isWaiting: boolean;
  /** 斜杠命令选中后的回调 */
  onCommand: (action: string) => void;
}

/** 聊天界面视图 */
export function ChatView({ messages, onSubmit, isWaiting, onCommand }: ChatViewProps) {
  const [input, setInput] = useState('');

  // 斜杠菜单状态
  const [showCommands, setShowCommands] = useState<boolean>(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  // 根据当前输入过滤命令
  const filteredCommands = SLASH_COMMANDS.filter((c) =>
    c.name.startsWith(input) || c.name.includes(input),
  );

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    // 如果菜单打开且有选中项，执行命令
    if (showCommands && filteredCommands.length > 0) {
      const cmd = filteredCommands[selectedIndex];
      if (cmd) {
        onCommand(cmd.action);
        setInput('');
        setShowCommands(false);
        return;
      }
    }

    if (isWaiting) return;

    onSubmit(trimmed);
    setInput('');
  };

  const handleInputChange = (value: string) => {
    setInput(value);

    if (value.startsWith('/')) {
      setShowCommands(true);
      setSelectedIndex(0);
    } else {
      setShowCommands(false);
    }
  };

  // 滚动跟随选中项
  const visibleSlice = calcVisibleSlice(filteredCommands.length, selectedIndex, MENU_VISIBLE_MAX);

  useInput((_input, key) => {
    if (key.ctrl && (_input === 'c' || _input === 'd')) {
      process.exit(0);
    }

    if (showCommands && filteredCommands.length > 0) {
      if (key.upArrow) {
        setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
        return;
      }
      if (key.escape) {
        setShowCommands(false);
        setInput('');
        return;
      }
      if (key.tab) {
        setInput(filteredCommands[selectedIndex]!.name + ' ');
        setShowCommands(false);
        return;
      }
    }
    // 菜单关闭时 ↑↓ 不做任何事，交给终端原生滚动
  });

  const displayedCommands = filteredCommands.slice(visibleSlice.start, visibleSlice.start + MENU_VISIBLE_MAX);

  return (
    <Box flexDirection="column">
      {/* 标题栏 */}
      <Box
        paddingLeft={1}
        paddingRight={1}
        borderStyle="single"
        borderColor="cyan"
      >
        <Text bold color="cyan">
          commit-log-daily
        </Text>
        <Text dimColor> · Agent</Text>
        <Text dimColor> · / 打开命令 · 滚轮翻看 · Ctrl+C 退出</Text>
      </Box>

      {/* 消息区域 — 渲染全部消息，溢出部分由终端原生 scrollback 处理 */}
      <Box flexDirection="column" paddingLeft={0} paddingRight={0}>
        {messages.length === 0 && (
          <Box paddingLeft={2} paddingTop={1}>
            <Text dimColor>发送消息开始对话…</Text>
          </Box>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}
        {isWaiting && (
          <Box paddingLeft={2} paddingTop={1}>
            <Text color="yellow">…思考中</Text>
          </Box>
        )}
      </Box>

      {/* 底部区域：斜杠命令菜单 + 输入框，flexShrink=0 不被挤压 */}
      <Box flexDirection="column" flexShrink={0} marginTop={0}>
        {/* 斜杠命令菜单 — 紧贴输入框上方 */}
        {showCommands && (
          <Box
            flexDirection="column"
            marginLeft={1}
            marginRight={1}
            paddingLeft={1}
            paddingRight={1}
          >
            {filteredCommands.length > MENU_VISIBLE_MAX && (
              <Box>
                <Text dimColor>
                  ({selectedIndex + 1}/{filteredCommands.length})
                </Text>
              </Box>
            )}
            {displayedCommands.length === 0 && (
              <Text dimColor>  无匹配命令</Text>
            )}
            {displayedCommands.map((cmd) => {
              const realIndex = filteredCommands.indexOf(cmd);
              const isSelected = realIndex === selectedIndex;
              const pointer = isSelected ? '▸' : ' ';
              const namePadded = cmd.name.padEnd(CMD_NAME_WIDTH);
              return (
                <Box key={cmd.name} gap={2}>
                  <Text color={isSelected ? 'cyan' : undefined}>
                    {pointer} {namePadded}
                  </Text>
                  <Text dimColor>{cmd.description}</Text>
                </Box>
              );
            })}
          </Box>
        )}

        {/* 输入框 */}
        <Box
          paddingLeft={1}
          paddingRight={1}
          borderStyle="round"
          borderColor={showCommands ? 'cyan' : 'green'}
          marginLeft={1}
          marginRight={1}
        >
          <TextInput
            value={input}
            onChange={handleInputChange}
            onSubmit={handleSubmit}
            placeholder={isWaiting ? ' 等待 Agent 响应…' : showCommands ? ' 输入命令…' : ' 输入消息 (/ 打开命令)…'}
          />
        </Box>
      </Box>
    </Box>
  );
}

/** 单条消息气泡 — Claude 风格 */
function MessageBubble({ message }: { message: ChatMessage }): React.ReactElement {
  if (message.role === 'system') {
    return (
      <Box flexDirection="column" paddingLeft={2} paddingRight={2} marginTop={0}>
        <Text dimColor>{message.content}</Text>
      </Box>
    );
  }

  if (message.role === 'user') {
    return <UserBubble content={message.content} />;
  }

  return <AssistantBubble content={message.content} />;
}

/** 用户消息 — 右对齐，绿色边框 */
function UserBubble({ content }: { content: string }): React.ReactElement {
  const lines = content.split('\n');

  return (
    <Box flexDirection="row" justifyContent="flex-end" paddingLeft={4} paddingRight={1} marginTop={0}>
      <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
        <Text bold color="green">
          You
        </Text>
        {lines.map((line, i) => (
          <Text key={i}>{line || ' '}</Text>
        ))}
      </Box>
    </Box>
  );
}

/** 助手消息 — 左对齐，蓝色左边框 */
function AssistantBubble({ content }: { content: string }): React.ReactElement {
  const lines = content.split('\n');

  return (
    <Box flexDirection="column" paddingLeft={0} paddingRight={2} marginTop={0}>
      <Box paddingLeft={2}>
        <Text bold color="cyan">
          Commit Log Daily
        </Text>
      </Box>
      <Box flexDirection="row">
        <Box paddingLeft={2} paddingRight={1}>
          <Text color="cyan">{'│'}</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          {lines.map((line, i) => (
            <Text key={i}>{line || ' '}</Text>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

/**
 * 计算菜单可视切片
 * 保持选中项在可视窗口内
 */
function calcVisibleSlice(
  total: number,
  selected: number,
  max: number,
): { start: number; count: number } {
  if (total <= max) {
    return { start: 0, count: total };
  }

  let start = selected - Math.floor(max / 2);
  if (start < 0) start = 0;
  if (start + max > total) start = total - max;

  return { start, count: max };
}
