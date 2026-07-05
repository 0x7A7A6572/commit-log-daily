import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
/** 聊天界面视图 */
export function ChatView({ messages, onSubmit, isWaiting }) {
    const { stdout } = useStdout();
    const [input, setInput] = useState('');
    const [termHeight, setTermHeight] = useState(() => stdout?.rows ?? 24);
    // 监听终端尺寸变化
    useEffect(() => {
        const onResize = () => setTermHeight(stdout?.rows ?? 24);
        stdout?.on('resize', onResize);
        return () => void stdout?.off('resize', onResize);
    }, [stdout]);
    // 处理回车
    const handleSubmit = (value) => {
        const trimmed = value.trim();
        if (!trimmed || isWaiting)
            return;
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
    const messageElements = [];
    for (const [i, msg] of visibleMessages.entries()) {
        messageElements.push(React.createElement(MessageBubble, { key: String(i), message: msg }));
    }
    return (_jsxs(Box, { flexDirection: "column", height: termHeight, children: [_jsxs(Box, { paddingLeft: 1, paddingRight: 1, children: [_jsxs(Text, { bold: true, color: "cyan", children: ['⚡', " commit-log-daily"] }), _jsx(Text, { dimColor: true, children: " agent mode | Ctrl+C \u9000\u51FA | Ctrl+E \u914D\u7F6E" })] }), _jsxs(Box, { flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1, children: [messageElements, isWaiting && (_jsx(Box, { children: _jsx(Text, { color: "yellow", children: "...\u601D\u8003\u4E2D" }) }))] }), _jsxs(Box, { paddingLeft: 1, paddingRight: 1, children: [_jsxs(Text, { color: "green", bold: true, children: ['❯', " ", ' '] }), _jsx(TextInput, { value: input, onChange: setInput, onSubmit: handleSubmit, placeholder: isWaiting ? '等待 Agent 响应...' : '输入消息，回车发送...' })] })] }));
}
/** 单条消息气泡 */
function MessageBubble({ message }) {
    const colorMap = {
        user: 'green',
        assistant: 'blue',
        system: 'yellow',
    };
    const labelMap = {
        user: '▸ 你',
        assistant: '✦ Agent',
        system: '◆ 系统',
    };
    const color = colorMap[message.role] ?? 'white';
    const label = labelMap[message.role] ?? message.role;
    const lines = message.content.split('\n');
    return (_jsxs(Box, { flexDirection: "column", marginBottom: 0, children: [_jsx(Text, { color: color, bold: true, children: label }), lines.map((line, i) => (_jsx(Text, { dimColor: message.role === 'system', children: line || ' ' }, i)))] }));
}
/**
 * 按可见行数截取最近消息
 * 每条消息约 content 行数 + 1 行角色标签
 */
function tailByLines(msgs, maxLines) {
    const result = [];
    let used = 0;
    for (let i = msgs.length - 1; i >= 0; i--) {
        const msg = msgs[i];
        const lines = msg.content.split('\n').length + 1;
        if (used + lines > maxLines && result.length > 0)
            break;
        result.unshift(msg);
        used += lines;
    }
    return result;
}
//# sourceMappingURL=ChatView.js.map