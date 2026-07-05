import { useState, useCallback, useRef } from 'react';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { createModelForPhase } from '../agent/base.js';
import { createEmptyContext, evaluatePhaseTransition, } from '../agent/session.js';
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
/**
 * 会话管理 Hook
 * 维护消息历史、阶段切换、与 Agent 交互
 */
export function useSession() {
    const [langMessages, setLangMessages] = useState([
        new SystemMessage('欢迎使用 commit-log-daily Agent。输入消息开始对话。'),
    ]);
    const [phase, setPhase] = useState('collect');
    const [isWaiting, setIsWaiting] = useState(false);
    const contextRef = useRef(createEmptyContext());
    const handleSubmit = useCallback(async (text) => {
        // 追加用户消息
        const userMsg = new HumanMessage(text);
        const updated = [...langMessages, userMsg];
        setLangMessages(updated);
        setIsWaiting(true);
        try {
            const model = createModelForPhase(phase);
            // 调用 LLM
            const aiMsg = await model.invoke(updated);
            // 检查是否有工具调用
            const aiMsgAny = aiMsg;
            if (aiMsgAny.tool_calls && aiMsgAny.tool_calls.length > 0) {
                // 处理工具调用
                const toolMessages = [];
                for (const tc of aiMsgAny.tool_calls) {
                    const result = await executeTool(tc.name, tc.args);
                    toolMessages.push(new ToolMessage({ content: result, tool_call_id: tc.id }));
                }
                // 带工具结果再次调用 LLM
                const withTools = [...updated, aiMsg, ...toolMessages];
                const finalMsg = await model.invoke(withTools);
                const allMessages = [...updated, aiMsg, ...toolMessages, finalMsg];
                setLangMessages(allMessages);
                const allLen = allMessages.length;
                const msg = allMessages[allLen - 1];
                // 检查阶段切换
                const content = typeof msg.content === 'string' ? msg.content : '';
                handlePhaseCheck(content, phase, contextRef.current, setPhase);
            }
            else {
                // 无工具调用，直接追加
                const allMessages = [...updated, aiMsg];
                setLangMessages(allMessages);
                // 检查阶段切换
                const content = typeof aiMsg.content === 'string' ? aiMsg.content : '';
                handlePhaseCheck(content, phase, contextRef.current, setPhase);
            }
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
    // 转换消息为 UI 格式
    const chatMessages = langMessages.map(toChatMessage);
    return {
        messages: chatMessages,
        phase,
        isWaiting,
        handleSubmit,
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