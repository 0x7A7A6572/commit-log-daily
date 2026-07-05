import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';

/** 聊天消息类型 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ChatViewProps {
  /** 当前消息列表 */
  messages: ChatMessage[];
  /** 用户提交消息的回调 */
  onSubmit: (text: string) => void;
  /** 是否正在等待 Agent 响应（显示加载指示） */
  isWaiting: boolean;
}

/** 聊天界面视图 */
export function ChatView({ messages, onSubmit, isWaiting }: ChatViewProps) {
  const { stdout } = useStdout();
  const [input, setInput] = useState('');
  const [termHeight, setTermHeight] = useState<number>(() => stdout?.rows ?? 24);

  // 监听终端尺寸变化
  useEffect(() => {
    const onResize = () => setTermHeight(stdout?.rows ?? 24);
    stdout?.on('resize', onResize);
    return () => void stdout?.off('resize', onResize);
  }, [stdout]);

  // 处理回车
  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || isWaiting) return;

    onSubmit(trimmed);
    setInput('');
  };

  useInput((_input, key) => {
    if (key.ctrl && (_input === 'c' || _input === 'd')) {
      process.exit(0);
    }
  });

  // 标题栏 + 输入区占的行数
  const HEADER_LINES = 1;
  const INPUT_LINES = 2;
  const maxMsgLines = Math.max(5, termHeight - HEADER_LINES - INPUT_LINES);

  // 按可见行数截取最近消息
  const visibleMessages = tailByLines(messages, maxMsgLines);

  const messageElements: React.ReactElement[] = [];

  for (const [i, msg] of visibleMessages.entries()) {
    messageElements.push(React.createElement(MessageBubble, { key: String(i), message: msg }));
  }

  return (
    <Box flexDirection="column" height={termHeight}>
      {/* 标题栏 */}
      <Box paddingLeft={1} paddingRight={1}>
        <Text bold color="cyan">
          {'⚡'} commit-log-daily
        </Text>
        <Text dimColor> agent mode | Ctrl+C 退出 | Ctrl+E 配置</Text>
      </Box>

      {/* 消息区域 */}
      <Box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
        {messageElements}
        {isWaiting && (
          <Box>
            <Text color="yellow">...思考中</Text>
          </Box>
        )}
      </Box>

      {/* 输入区域 */}
      <Box paddingLeft={1} paddingRight={1}>
        <Text color="green" bold>
          {'❯'} {' '}
        </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder={isWaiting ? '等待 Agent 响应...' : '输入消息，回车发送...'}
        />
      </Box>
    </Box>
  );
}

/** 单条消息气泡 */
function MessageBubble({ message }: { message: ChatMessage }): React.ReactElement {
  const colorMap: Record<string, string> = {
    user: 'green',
    assistant: 'blue',
    system: 'yellow',
  };
  const labelMap: Record<string, string> = {
    user: '▸ 你',
    assistant: '✦ Agent',
    system: '◆ 系统',
  };

  const color = colorMap[message.role] ?? 'white';
  const label = labelMap[message.role] ?? message.role;

  const lines = message.content.split('\n');

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Text color={color} bold>
        {label}
      </Text>
      {lines.map((line, i) => (
        <Text key={i} dimColor={message.role === 'system'}>
          {line || ' '}
        </Text>
      ))}
    </Box>
  );
}

/**
 * 按可见行数截取最近消息
 * 每条消息约 content 行数 + 1 行角色标签
 */
function tailByLines(msgs: ChatMessage[], maxLines: number): ChatMessage[] {
  const result: ChatMessage[] = [];
  let used = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i]!;
    const lines = msg.content.split('\n').length + 1;
    if (used + lines > maxLines && result.length > 0) break;
    result.unshift(msg);
    used += lines;
  }
  return result;
}
