import { useState, useCallback, useRef } from 'react';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { createModelForPhase } from '../agent/base.js';
import { createEmptyContext, evaluatePhaseTransition, } from '../agent/session.js';
import { createSession, saveMessage, saveContext, loadSession } from '../session/store.js';
/** 将 LangChain BaseMessage 转为 UI 消息 */
function toChatMessage(msg) {
    const roleMap = {
        human: 'user',
        ai: 'assistant',
        system: 'system',
        tool: 'system',
    };
    const role = roleMap[msg.getType()] ?? 'system';
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    return { role, content };
}
/** 将 LangChain BaseMessage 序列化为存储格式 */
function serializeMessage(msg) {
    const role = msg.getType();
    const stored = {
        role,
        content: msg.content,
    };
    // AIMessage 可能携带 tool_calls
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msgAny = msg;
    if (msgAny.tool_calls) {
        stored.tool_calls = msgAny.tool_calls;
    }
    if (msgAny.tool_call_id) {
        stored.tool_call_id = msgAny.tool_call_id;
    }
    return JSON.stringify(stored);
}
/** 从存储格式还原为 LangChain BaseMessage */
function deserializeMessage(stored) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msgAny = stored;
    switch (stored.role) {
        case 'human':
            return new HumanMessage(stored.content);
        case 'ai':
            if (msgAny.tool_calls && msgAny.tool_calls.length > 0) {
                return new AIMessage({
                    content: typeof stored.content === 'string' ? stored.content : '',
                    tool_calls: msgAny.tool_calls,
                });
            }
            return new AIMessage(stored.content);
        case 'tool':
            return new ToolMessage({
                content: typeof stored.content === 'string' ? stored.content : JSON.stringify(stored.content),
                tool_call_id: msgAny.tool_call_id ?? 'unknown',
            });
        default:
            return new AIMessage(stored.content);
    }
}
/** 欢迎语 */
const WELCOME_TEXT = '欢迎使用 commit-log-daily Agent。输入消息开始对话。';
/**
 * 会话管理 Hook
 * 维护消息历史、阶段切换、与 Agent 交互
 */
export function useSession() {
    const [langMessages, setLangMessages] = useState([
        new SystemMessage(WELCOME_TEXT),
    ]);
    const [phase, setPhase] = useState('collect');
    const [isWaiting, setIsWaiting] = useState(false);
    const contextRef = useRef(createEmptyContext());
    const currentSessionIdRef = useRef(null);
    const handleSubmit = useCallback(async (text) => {
        // 追加用户消息
        const userMsg = new HumanMessage(text);
        const updated = [...langMessages, userMsg];
        setLangMessages(updated);
        setIsWaiting(true);
        try {
            // 计算用户消息的 seq（首次为 0，后续为已有非 system 消息数）
            let userSeq;
            if (currentSessionIdRef.current === null) {
                const dateStr = new Date().toISOString().slice(0, 10);
                const title = `${dateStr}-${text.slice(0, 20)}`;
                currentSessionIdRef.current = createSession(title);
                userSeq = 0;
            }
            else {
                userSeq = langMessages.filter((m) => m.getType() !== 'system').length;
            }
            saveMessage(currentSessionIdRef.current, 'human', serializeMessage(userMsg), userSeq);
            const model = createModelForPhase(phase);
            let msgSeq = userSeq + 1;
            // 调用 LLM
            const aiMsg = await model.invoke(updated);
            // 检查是否有工具调用
            const aiMsgAny = aiMsg;
            let allMessages;
            if (aiMsgAny.tool_calls && aiMsgAny.tool_calls.length > 0) {
                // 保存 AI 消息（含 tool_calls）
                saveMessage(currentSessionIdRef.current, 'ai', serializeMessage(aiMsg), msgSeq++);
                // 处理工具调用
                const toolMessages = [];
                for (const tc of aiMsgAny.tool_calls) {
                    const result = await executeTool(tc.name, tc.args);
                    const toolMsg = new ToolMessage({ content: result, tool_call_id: tc.id });
                    toolMessages.push(toolMsg);
                    // 保存 Tool 消息
                    saveMessage(currentSessionIdRef.current, 'tool', serializeMessage(toolMsg), msgSeq++);
                }
                // 带工具结果再次调用 LLM
                const withTools = [...updated, aiMsg, ...toolMessages];
                const finalMsg = await model.invoke(withTools);
                // 保存最终 AI 消息
                saveMessage(currentSessionIdRef.current, 'ai', serializeMessage(finalMsg), msgSeq++);
                allMessages = [...updated, aiMsg, ...toolMessages, finalMsg];
            }
            else {
                // 无工具调用，保存 AI 文本消息
                saveMessage(currentSessionIdRef.current, 'ai', serializeMessage(aiMsg), msgSeq++);
                allMessages = [...updated, aiMsg];
            }
            setLangMessages(allMessages);
            // 保存上下文
            saveContext(currentSessionIdRef.current, phase, contextRef.current);
            // 检查阶段切换
            const lastMsg = allMessages[allMessages.length - 1];
            const content = typeof lastMsg.content === 'string' ? lastMsg.content : '';
            handlePhaseCheck(content, phase, contextRef.current, setPhase);
        }
        catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            setLangMessages((prev) => [
                ...prev,
                new AIMessage(`执行出错: ${errMsg}`),
            ]);
        }
        finally {
            setIsWaiting(false);
        }
    }, [langMessages, phase]);
    /** 从历史恢复会话 */
    const loadHistorySession = useCallback((sessionId) => {
        const full = loadSession(sessionId);
        if (!full)
            return;
        // 还原消息（不包含 system —— system 消息在下方重新注入）
        const restored = full.messages.map(deserializeMessage);
        // 注入 SystemMessage（欢迎语）
        restored.unshift(new SystemMessage(WELCOME_TEXT));
        setLangMessages(restored);
        setPhase(full.phase);
        contextRef.current = full.context;
        currentSessionIdRef.current = full.id;
    }, []);
    // 转换消息为 UI 格式
    const chatMessages = langMessages.map(toChatMessage);
    return {
        messages: chatMessages,
        phase,
        isWaiting,
        handleSubmit,
        loadHistorySession,
    };
}
/**
 * 执行单个工具调用
 */
async function executeTool(name, args) {
    // 动态导入工具模块（避免循环依赖）
    const { scanGitTool } = await import('../agent/tools/scanGit.js');
    const { listProjectsTool, addProjectTool, removeProjectTool } = await import('../agent/tools/projects.js');
    const { getConfigTool, setConfigTool } = await import('../agent/tools/config-tool.js');
    const { exportFileTool } = await import('../agent/tools/exportFile.js');
    const { generateReportTool } = await import('../agent/tools/generate.js');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolMap = {
        scanGit: scanGitTool,
        listProjects: listProjectsTool,
        addProject: addProjectTool,
        removeProject: removeProjectTool,
        getConfig: getConfigTool,
        setConfig: setConfigTool,
        exportFile: exportFileTool,
        generateReport: generateReportTool,
    };
    const tool = toolMap[name];
    if (!tool) {
        return `未知工具: ${name}`;
    }
    return tool.invoke(args);
}
/**
 * 检查并处理阶段切换
 */
function handlePhaseCheck(content, currentPhase, context, setPhase) {
    const newPhase = evaluatePhaseTransition(currentPhase, content, context);
    if (newPhase !== currentPhase) {
        setPhase(newPhase);
    }
}
//# sourceMappingURL=useSession.js.map