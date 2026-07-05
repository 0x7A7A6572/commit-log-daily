import { useState, useCallback } from 'react';
import { render, useInput } from 'ink';
import { ChatView } from './ChatView.js';
import { ConfigView } from './ConfigView.js';
import { HistoryView } from './HistoryView.js';
import { ProjectsView } from './ProjectsView.js';
import { useSession } from './useSession.js';
import type { FullSession } from '../session/types.js';

/** 视图模式 */
type ViewMode = 'chat' | 'config' | 'history' | 'projects';

/** TUI 主应用组件 */
function App() {
  const [view, setView] = useState<ViewMode>('chat');
  const { messages, isWaiting, handleSubmit, loadHistorySession } = useSession();

  // Ctrl+E 切换配置视图
  useInput((input, key) => {
    if (key.ctrl && input === 'e') {
      setView((prev) => (prev === 'config' ? 'chat' : 'config'));
    }
  });

  /** 处理斜杠命令 */
  const handleCommand = useCallback(
    (action: string) => {
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
        case 'projects':
          setView('projects');
          break;
      }
    },
    [handleSubmit],
  );

  const handleConfigClose = useCallback(() => {
    setView('chat');
  }, []);

  /** 从历史会话恢复，切换回聊天视图 */
  const handleRestore = useCallback(
    (session: FullSession) => {
      loadHistorySession(session.id);
      setView('chat');
    },
    [loadHistorySession],
  );

  const handleHistoryBack = useCallback(() => {
    setView('chat');
  }, []);

  if (view === 'config') {
    return <ConfigView onClose={handleConfigClose} />;
  }

  if (view === 'history') {
    return <HistoryView onRestore={handleRestore} onBack={handleHistoryBack} />;
  }

  if (view === 'projects') {
    return <ProjectsView onBack={() => setView('chat')} />;
  }

  return (
    <ChatView
      messages={messages}
      onSubmit={handleSubmit}
      isWaiting={isWaiting}
      onCommand={handleCommand}
    />
  );
}

/** 启动 TUI Agent 模式 */
export function startAgentTui(): void {
  render(<App />);
}
