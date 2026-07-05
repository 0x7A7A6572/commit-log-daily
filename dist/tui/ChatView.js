import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
/** 可用命令列表 */
const SLASH_COMMANDS = [
    { name: '/config', description: '打开配置页', action: 'config' },
    { name: '/export', description: '导出报告到文件', action: 'export' },
    { name: '/projects', description: '管理项目列表', action: 'projects' },
    { name: '/history', description: '查看历史会话', action: 'history' },
    { name: '/quit', description: '退出程序', action: 'quit' },
];
/** 菜单最多可见条数 */
const MENU_VISIBLE_MAX = 5;
/** 命令名列宽（最长的命令名 + 2 空格） */
const CMD_NAME_WIDTH = Math.max(...SLASH_COMMANDS.map((c) => c.name.length)) + 2;
/** 聊天界面视图 */
export function ChatView({ messages, onSubmit, isWaiting, onCommand }) {
    const [input, setInput] = useState('');
    // 斜杠菜单状态
    const [showCommands, setShowCommands] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    // 根据当前输入过滤命令
    const filteredCommands = SLASH_COMMANDS.filter((c) => c.name.startsWith(input) || c.name.includes(input));
    const handleSubmit = (value) => {
        const trimmed = value.trim();
        if (!trimmed)
            return;
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
        if (isWaiting)
            return;
        onSubmit(trimmed);
        setInput('');
    };
    const handleInputChange = (value) => {
        setInput(value);
        if (value.startsWith('/')) {
            setShowCommands(true);
            setSelectedIndex(0);
        }
        else {
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
                setInput(filteredCommands[selectedIndex].name + ' ');
                setShowCommands(false);
                return;
            }
        }
        // 菜单关闭时 ↑↓ 不做任何事，交给终端原生滚动
    });
    const displayedCommands = filteredCommands.slice(visibleSlice.start, visibleSlice.start + MENU_VISIBLE_MAX);
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { paddingLeft: 1, paddingRight: 1, children: [_jsxs(Text, { bold: true, color: "cyan", children: ['⚡', " commit-log-daily"] }), _jsx(Text, { dimColor: true, children: " agent mode | / \u547D\u4EE4 | \u6EDA\u8F6E\u7FFB\u770B | Ctrl+C \u9000\u51FA" })] }), _jsxs(Box, { flexDirection: "column", paddingLeft: 1, paddingRight: 1, children: [messages.length === 0 && (_jsx(Box, { paddingTop: 1, children: _jsx(Text, { dimColor: true, children: "\u53D1\u9001\u6D88\u606F\u5F00\u59CB\u5BF9\u8BDD\u2026" }) })), messages.map((msg, i) => (_jsx(MessageBubble, { message: msg }, i))), isWaiting && (_jsx(Box, { children: _jsx(Text, { color: "yellow", children: "...\u601D\u8003\u4E2D" }) }))] }), _jsxs(Box, { flexDirection: "column", flexShrink: 0, marginTop: 0, children: [showCommands && (_jsxs(Box, { flexDirection: "column", marginLeft: 1, marginRight: 1, paddingLeft: 1, paddingRight: 1, children: [_jsx(Box, { children: filteredCommands.length > MENU_VISIBLE_MAX && (_jsxs(Text, { dimColor: true, children: ["(", selectedIndex + 1, "/", filteredCommands.length, ")"] })) }), displayedCommands.length === 0 && (_jsx(Text, { dimColor: true, children: "  \u65E0\u5339\u914D\u547D\u4EE4" })), displayedCommands.map((cmd) => {
                                const realIndex = filteredCommands.indexOf(cmd);
                                const isSelected = realIndex === selectedIndex;
                                const pointer = isSelected ? '▸' : ' ';
                                const namePadded = cmd.name.padEnd(CMD_NAME_WIDTH);
                                return (_jsxs(Box, { gap: 2, children: [_jsxs(Text, { color: isSelected ? 'cyan' : undefined, children: [pointer, " ", namePadded] }), _jsx(Text, { dimColor: true, children: cmd.description })] }, cmd.name));
                            })] })), _jsxs(Box, { paddingLeft: 1, paddingRight: 1, children: [_jsxs(Text, { color: "green", bold: true, children: ['❯', " ", ' '] }), _jsx(TextInput, { value: input, onChange: handleInputChange, onSubmit: handleSubmit, placeholder: isWaiting ? '等待 Agent 响应...' : showCommands ? '输入命令…' : '输入消息 (/ 打开命令)…' })] })] })] }));
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
 * 计算菜单可视切片
 * 保持选中项在可视窗口内
 */
function calcVisibleSlice(total, selected, max) {
    if (total <= max) {
        return { start: 0, count: total };
    }
    let start = selected - Math.floor(max / 2);
    if (start < 0)
        start = 0;
    if (start + max > total)
        start = total - max;
    return { start, count: max };
}
//# sourceMappingURL=ChatView.js.map