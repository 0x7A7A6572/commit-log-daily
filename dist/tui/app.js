import { jsx as _jsx } from "react/jsx-runtime";
import { useState, useCallback } from 'react';
import { render, useInput } from 'ink';
import { ChatView } from './ChatView.js';
import { ConfigView } from './ConfigView.js';
import { HistoryView } from './HistoryView.js';
import { useSession } from './useSession.js';
/** TUI 主应用组件 */
function App() {
    const [view, setView] = useState('chat');
    const { messages, isWaiting, handleSubmit, loadHistorySession } = useSession();
    // Ctrl+E 切换配置视图
    useInput((input, key) => {
        if (key.ctrl && input === 'e') {
            setView((prev) => (prev === 'config' ? 'chat' : 'config'));
        }
    });
    /** 处理斜杠命令 */
    const handleCommand = useCallback((action) => {
        switch (action) {
            case 'config':
                setView('config');
                break;
            case 'history':
                setView('history');
                break;
            case 'quit':
                process.exit(0);
                break;
            case 'export':
                handleSubmit('导出报告到文件');
                break;
            case 'projects':
                handleSubmit('查看当前项目列表');
                break;
        }
    }, [handleSubmit]);
    const handleConfigClose = useCallback(() => {
        setView('chat');
    }, []);
    /** 从历史会话恢复，切换回聊天视图 */
    const handleRestore = useCallback((session) => {
        loadHistorySession(session.id);
        setView('chat');
    }, [loadHistorySession]);
    const handleHistoryBack = useCallback(() => {
        setView('chat');
    }, []);
    if (view === 'config') {
        return _jsx(ConfigView, { onClose: handleConfigClose });
    }
    if (view === 'history') {
        return _jsx(HistoryView, { onRestore: handleRestore, onBack: handleHistoryBack });
    }
    return (_jsx(ChatView, { messages: messages, onSubmit: handleSubmit, isWaiting: isWaiting, onCommand: handleCommand }));
}
/** 启动 TUI Agent 模式 */
export function startAgentTui() {
    render(_jsx(App, {}));
}
//# sourceMappingURL=app.js.map