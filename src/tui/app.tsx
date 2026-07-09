import { useState, useCallback } from 'react';
import { render } from 'ink';
import { ChatView } from './ChatView.js';
import { ConfigView } from './ConfigView.js';
import { HistoryView } from './HistoryView.js';
import { ProjectsView } from './ProjectsView.js';
import { TemplatesView } from './TemplatesView.js';
import { ProjectDetailView } from './ProjectDetailView.js';
import { useSession } from './useSession.js';
import type { FullSession } from '../session/types.js';

/** 视图模式 */
type ViewMode = 'chat' | 'config' | 'history' | 'projects' | 'templates' | 'projectDetail';

/** TUI 主应用组件 */
function App() {
  const [view, setView] = useState<ViewMode>('chat');
  const [detailProjectName, setDetailProjectName] = useState<string>('');
  const [detailProjectPath, setDetailProjectPath] = useState<string>('');
  const { messages, isWaiting, tokenUsage, handleSubmit, loadHistorySession, pendingApproval, handleApproval } = useSession();


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
        case 'templates':
          setView('templates');
          break;
      }
    },
    [],
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

  /** 选中项目 — 进入项目详情视图 */
  const handleProjectsSelect = useCallback((name: string, path: string) => {
    setDetailProjectName(name);
    setDetailProjectPath(path);
    setView('projectDetail');
  }, []);

  if (view === 'config') {
    return <ConfigView onClose={handleConfigClose} />;
  }

  if (view === 'history') {
    return <HistoryView onRestore={handleRestore} onBack={handleHistoryBack} />;
  }

  if (view === 'projects') {
    return <ProjectsView onBack={() => setView('chat')} onSelect={handleProjectsSelect} />;
  }

  if (view === 'templates') {
    return <TemplatesView onBack={() => setView('chat')} />;
  }

  if (view === 'projectDetail') {
    return (
      <ProjectDetailView
        projectName={detailProjectName}
        projectPath={detailProjectPath}
        onBack={() => setView('projects')}
      />
    );
  }

  return (
    <ChatView
      messages={messages}
      tokenUsage={tokenUsage}
      onSubmit={handleSubmit}
      isWaiting={isWaiting}
      onCommand={handleCommand}
      pendingApproval={pendingApproval}
      onApproval={handleApproval}
    />
  );
}

/** 启动 TUI Agent 模式 */
export function startAgentTui(): void {
  render(<App />);
}
