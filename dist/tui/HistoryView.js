import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { listSessions, deleteSession, loadSession } from '../session/store.js';
/** 历史会话列表视图 */
export function HistoryView({ onRestore, onBack }) {
    const [sessions, setSessions] = useState([]);
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
            if (sessions.length === 0)
                return;
            if (deleteConfirm) {
                setDeleteConfirm(false);
                return;
            }
            const full = loadSession(sessions[selectedIndex].id);
            if (full) {
                onRestore(full);
            }
            return;
        }
        if (input === 'd') {
            if (sessions.length === 0)
                return;
            if (deleteConfirm) {
                // 二次确认后删除
                const sessionId = sessions[selectedIndex].id;
                deleteSession(sessionId);
                const updated = listSessions();
                setSessions(updated);
                setSelectedIndex((prev) => Math.min(prev, updated.length - 1));
                setDeleteConfirm(false);
            }
            else {
                setDeleteConfirm(true);
            }
            return;
        }
        // 任意其他键取消删除确认
        setDeleteConfirm(false);
    });
    const selectedSession = sessions[selectedIndex] ?? null;
    return (_jsxs(Box, { flexDirection: "column", height: 24, children: [_jsxs(Box, { paddingLeft: 1, paddingRight: 1, children: [_jsxs(Text, { bold: true, color: "cyan", children: ['⚡', " commit-log-daily"] }), _jsx(Text, { dimColor: true, children: " \u00B7 \u5386\u53F2\u4F1A\u8BDD \u00B7 q \u8FD4\u56DE" })] }), _jsxs(Box, { flexDirection: "column", flexGrow: 1, paddingLeft: 2, paddingRight: 2, paddingTop: 1, children: [sessions.length === 0 && (_jsx(Box, { paddingTop: 1, children: _jsx(Text, { dimColor: true, children: "\u6682\u65E0\u5386\u53F2\u4F1A\u8BDD" }) })), sessions.map((session, index) => {
                        const isSelected = index === selectedIndex;
                        const dateStr = session.createdAt.slice(0, 10);
                        const pointer = isSelected ? '▸' : ' ';
                        const color = isSelected ? 'cyan' : undefined;
                        return (_jsxs(Box, { flexDirection: "row", children: [_jsxs(Text, { color: color, children: [pointer, " ", dateStr] }), _jsxs(Text, { color: color, children: ["  ", session.title] }), _jsxs(Text, { dimColor: true, children: ["  ", session.phase] }), _jsxs(Text, { dimColor: true, children: ["  ", session.messageCount, " \u6761\u6D88\u606F"] })] }, session.id));
                    })] }), _jsx(Box, { flexDirection: "column", flexShrink: 0, paddingLeft: 2, paddingRight: 2, paddingBottom: 0, children: deleteConfirm && selectedSession ? (_jsx(Box, { paddingTop: 0, children: _jsxs(Text, { color: "red", children: ["\u786E\u8BA4\u5220\u9664 \"", selectedSession.title, "\"\uFF1F\u518D\u6309\u4E00\u6B21 d \u786E\u8BA4\uFF0C\u5176\u4ED6\u952E\u53D6\u6D88"] }) })) : (_jsx(Box, { paddingTop: 0, children: _jsx(Text, { dimColor: true, children: "Enter \u6062\u590D  d \u5220\u9664  q \u8FD4\u56DE" }) })) })] }));
}
//# sourceMappingURL=HistoryView.js.map