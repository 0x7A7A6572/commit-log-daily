import { jsx as _jsx } from "react/jsx-runtime";
import { useState, useCallback } from 'react';
import { render, useInput } from 'ink';
import { ChatView } from './ChatView.js';
import { ConfigView } from './ConfigView.js';
import { useSession } from './useSession.js';
/** TUI 主应用组件 */
function App() {
    const [view, setView] = useState('chat');
    const { messages, isWaiting, handleSubmit } = useSession();
    // Ctrl+E 切换视图
    useInput((input, key) => {
        if (key.ctrl && input === 'e') {
            setView((prev) => (prev === 'chat' ? 'config' : 'chat'));
        }
    });
    const handleConfigClose = useCallback(() => {
        setView('chat');
    }, []);
    if (view === 'config') {
        return _jsx(ConfigView, { onClose: handleConfigClose });
    }
    return (_jsx(ChatView, { messages: messages, onSubmit: handleSubmit, isWaiting: isWaiting }));
}
/** 启动 TUI Agent 模式 */
export function startAgentTui() {
    render(_jsx(App, {}));
}
//# sourceMappingURL=app.js.map