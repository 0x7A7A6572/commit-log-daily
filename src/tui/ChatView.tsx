import React, { useState, useRef } from "react";
import { Box, Text, useInput, Static } from "ink";
import { LoadingView } from "./components/Loading.js";
import { MultilineTextInput } from "./components/MultilineTextInput.js";
import { LOGO, WELCOME_GUIDE } from "./welcome.js";
import { readConfig } from "../config/store.js";
import type { SessionContext } from "../agent/types.js";
import { tokenCountToUnit } from "../shared/utils.js";

/** 单条工具调用展示信息 */
export interface ToolCallDisplay {
  id: string;
  name: string;
  /** 工具调用参数 */
  args: Record<string, unknown>;
  /** 工具执行结果（来自 ToolMessage） */
  result?: string;
  /** 工具执行状态 */
  status?: "success" | "error";
}

/** 聊天消息类型 */
export interface ChatMessage {
  /** LangChain BaseMessage.id，用于 React 稳定 key 避免流式输出时全量重绘 */
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  /** 思考过程（DeepSeek: additional_kwargs.reasoning_content，通用: reasoning content block） */
  reasoning?: string;
  /** 本次消息携带的工具调用 */
  toolCalls?: ToolCallDisplay[];
  /** 本次消息的 token 消耗 */
  tokenUsage?: { input_tokens: number; output_tokens: number };
}

/** 待审批的操作（来自 execTool 的 interrupt） */
export interface PendingApproval {
  command: string;
  args: string[];
  message: string;
}

/** 斜杠命令定义 */
interface SlashCommand {
  name: string;
  description: string;
  action: string;
}

/** 可用命令列表 */
const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/config", description: "打开配置页", action: "config" },
  { name: "/projects", description: "管理项目列表", action: "projects" },
  { name: "/templates", description: "管理报告模板", action: "templates" },
  { name: "/history", description: "查看历史会话", action: "history" },
  { name: "/quit", description: "退出程序", action: "quit" },
];

/** 菜单最多可见条数 */
const MENU_VISIBLE_MAX = 5;

/** 命令名列宽（最长的命令名 + 2 空格） */
const CMD_NAME_WIDTH =
  Math.max(...SLASH_COMMANDS.map((c) => c.name.length)) + 2;

interface ChatViewProps {
  /** 当前消息列表 */
  messages: ChatMessage[];
  /** 当前会话累计 token 消耗 */
  tokenUsage: SessionContext["tokenUsage"];
  /** 用户提交消息的回调 */
  onSubmit: (text: string) => void;
  /** 是否正在等待 Agent 响应 */
  isWaiting: boolean;
  /** 斜杠命令选中后的回调 */
  onCommand: (action: string) => void;
  /** 待用户审批的操作（execTool 中断时弹出确认） */
  pendingApproval: PendingApproval | null;
  /** 用户审批决策回调 */
  onApproval: (decision: "approve" | "reject") => void;
}

/** 聊天界面视图 */
export function ChatView({
  messages,
  tokenUsage,
  onSubmit,
  isWaiting,
  onCommand,
  pendingApproval,
  onApproval,
}: ChatViewProps) {
  const [input, setInput] = useState("");

  // 斜杠菜单状态
  const [showCommands, setShowCommands] = useState<boolean>(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  // 读取安全模式状态
  const config = readConfig();
  const safeMode = config.safety.safeMode;

  // 工具调用详情折叠状态（Ctrl+T 切换），默认折叠
  const [showToolDetails, setShowToolDetails] = useState(false);

  // 追踪已固化到 <Static> 的消息数量，避免 Ink 全屏重绘导致终端滚动复位
  const committedCountRef = useRef(0);
  // 消息列表完全替换时（如加载历史会话），重置固化计数
  if (messages.length < committedCountRef.current) {
    committedCountRef.current = 0;
  }
  // 流式响应时保留最后一条消息在动态区域（内容持续变化），
  // 非流式时保留最后 2 条用于上下文视觉
  const commitTarget =
    isWaiting && messages.length > 0
      ? messages.length - 1
      : messages.length > 2
        ? messages.length - 2
        : 0;
  if (commitTarget > committedCountRef.current) {
    committedCountRef.current = commitTarget;
  }

  const stableMessages = messages.slice(0, committedCountRef.current);
  const liveMessages = messages.slice(committedCountRef.current);

  // 输入框边框颜色：安全模式关闭时用黄色警告
  const inputBorderColor = safeMode
    ? showCommands
      ? "cyan"
      : "green"
    : "yellow";

  // 根据当前输入过滤命令
  const filteredCommands = SLASH_COMMANDS.filter(
    (c) => c.name.startsWith(input) || c.name.includes(input),
  );

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    // 如果菜单打开且有选中项，执行命令
    if (showCommands && filteredCommands.length > 0) {
      const cmd = filteredCommands[selectedIndex];
      if (cmd) {
        onCommand(cmd.action);
        setInput("");
        setShowCommands(false);
        return;
      }
    }

    if (isWaiting) return;

    onSubmit(trimmed);
    setInput("");
  };

  const handleInputChange = (value: string) => {
    setInput(value);

    if (value.startsWith("/")) {
      setShowCommands(true);
      setSelectedIndex(0);
    } else {
      setShowCommands(false);
    }
  };

  // 滚动跟随选中项
  const visibleSlice = calcVisibleSlice(
    filteredCommands.length,
    selectedIndex,
    MENU_VISIBLE_MAX,
  );

  useInput((_input, key) => {
    if (key.ctrl && (_input === "c" || _input === "d")) {
      process.exit(0);
    }

    // Ctrl+T 切换工具调用详情折叠
    if (key.ctrl && _input === "t") {
      setShowToolDetails((prev) => !prev);
      return;
    }

    if (showCommands && filteredCommands.length > 0) {
      if (key.upArrow) {
        setSelectedIndex(
          (prev) =>
            (prev - 1 + filteredCommands.length) % filteredCommands.length,
        );
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
        return;
      }
      if (key.escape) {
        setShowCommands(false);
        setInput("");
        return;
      }
      if (key.tab) {
        setInput(filteredCommands[selectedIndex]!.name + " ");
        setShowCommands(false);
        return;
      }
    }
    // 菜单关闭时 ↑↓ 不做任何事，交给终端原生滚动
  });

  const displayedCommands = filteredCommands.slice(
    visibleSlice.start,
    visibleSlice.start + MENU_VISIBLE_MAX,
  );

  return (
    <Box flexDirection="column">
      {/* 静态区：已固化的历史消息，写入终端 scrollback 后不再被 Ink 重绘 */}
      <Static items={stableMessages}>
        {(msg: ChatMessage, index: number) => (
          <MessageBubble
            key={msg.id ?? `static-${index}`}
            message={msg}
            showToolDetails={showToolDetails}
          />
        )}
      </Static>

      {/* 动态区：最新消息（流式更新中）+ 欢迎语 + 输入框，仅此区域被 Ink 重绘 */}
      <Box flexDirection="column" paddingLeft={0} paddingRight={0}>
        {liveMessages.length === 0 && !isWaiting && (
          <Box paddingLeft={2} paddingTop={1} flexDirection="column">
            <Text>{LOGO}</Text>
            <Text dimColor>{WELCOME_GUIDE}</Text>
          </Box>
        )}
        {liveMessages.map((msg, i) => (
          <MessageBubble
            key={msg.id ?? `live-${i}`}
            message={msg}
            showToolDetails={showToolDetails}
          />
        ))}
        {isWaiting && (
          <Box paddingLeft={2} paddingTop={1}>
            <LoadingView loadingText="thinking..." color="yellow" loading />
          </Box>
        )}
      </Box>

      {/* 底部区域：斜杠命令菜单 + 审批确认 + 输入框，flexShrink=0 不被挤压 */}
      <Box flexDirection="column" flexShrink={0} marginTop={0}>
        {/* 斜杠命令菜单 — 紧贴输入框上方 */}
        {showCommands && (
          <Box
            flexDirection="column"
            marginLeft={1}
            marginRight={1}
            paddingLeft={1}
            paddingRight={1}
          >
            {filteredCommands.length > MENU_VISIBLE_MAX && (
              <Box>
                <Text dimColor>
                  ({selectedIndex + 1}/{filteredCommands.length})
                </Text>
              </Box>
            )}
            {displayedCommands.length === 0 && (
              <Text dimColor> 无匹配命令</Text>
            )}
            {displayedCommands.map((cmd) => {
              const realIndex = filteredCommands.indexOf(cmd);
              const isSelected = realIndex === selectedIndex;
              const pointer = isSelected ? "❯" : " ";
              const namePadded = cmd.name.padEnd(CMD_NAME_WIDTH);
              return (
                <Box key={cmd.name} gap={2}>
                  <Text color={isSelected ? "cyan" : undefined}>
                    {pointer} {namePadded}
                  </Text>
                  <Text dimColor>{cmd.description}</Text>
                </Box>
              );
            })}
          </Box>
        )}

        {/* 安全审批确认横幅 */}
        {pendingApproval && (
          <ApprovalBanner approval={pendingApproval} onApproval={onApproval} />
        )}

        {/* 输入框 */}
        <Box
          paddingLeft={1}
          paddingRight={1}
          borderStyle="round"
          borderColor={inputBorderColor}
          marginLeft={1}
          marginRight={1}
        >
          <MultilineTextInput
            value={input}
            onChange={handleInputChange}
            onSubmit={handleSubmit}
            placeholder={
              isWaiting
                ? " 等待 Agent 响应…"
                : showCommands
                  ? " 输入命令…"
                  : " 输入消息 (Shift+Enter 换行, / 打开命令)…"
            }
          />
          {/* <Text dimColor> · / 打开命令 · Ctrl+C 退出</Text> */}
        </Box>

        {/* 当前模式和 token 消耗 */}
        <Box paddingLeft={2} paddingRight={1} marginTop={0} gap={2}>
          <Text dimColor>{safeMode ? "SAFE MODE" : "UNRESTRICTED MODE"}</Text>
          <Text dimColor>|</Text>
          <Text dimColor>
            Tokens: in {tokenCountToUnit(tokenUsage?.input_tokens ?? 0)} / out{" "}
            {tokenCountToUnit(tokenUsage?.output_tokens ?? 0)}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

/** 单条消息气泡 — Claude 风格，memo 防止流式渲染时非最后一条消息重绘 */
const MessageBubble = React.memo(function MessageBubble({
  message,
  showToolDetails,
}: {
  message: ChatMessage;
  showToolDetails: boolean;
}) {
  if (message.role === "system") {
    const lines = message.content.split("\n");
    return (
      <Box
        flexDirection="row"
        justifyContent="flex-start"
        paddingLeft={1}
        paddingRight={1}
        marginTop={2}
      >
        <Box flexDirection="column" paddingBottom={1} borderStyle="single" borderColor="green">
          <Box backgroundColor="greenBright" marginBottom={1}>
            <Text bold color="white">
              {" =] "}System:{" "}
            </Text>
          </Box>
          {lines.map((line, i) => (
            <Box key={i} marginLeft={1}>
              <Text color="greenBright">{line || " "}</Text>
            </Box>
          ))}
        </Box>
      </Box>
    );
  }

  if (message.role === "user") {
    return <UserBubble content={message.content} />;
  }

  return (
    <AssistantBubble message={message} showToolDetails={showToolDetails} />
  );
});

/** 用户消息 — 左对齐，白色背景 */
function UserBubble({ content }: { content: string }): React.ReactElement {
  const lines = content.split("\n");

  return (
    <Box
      flexDirection="row"
      justifyContent="flex-start"
      paddingLeft={1}
      paddingRight={1}
      marginTop={2}
      backgroundColor="white"
    >
      <Box flexDirection="column" paddingRight={1}>
        <Box>
          <Text bold color="black">
            {":)"}You:{" "}
          </Text>
        </Box>
        {lines.map((line, i) => (
          <Box key={i}>
            <Text color="black">{line || " "}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/** 助手消息 — 左对齐，蓝色左边框，展示思考过程 + 工具调用 + 文本 + token */
function AssistantBubble({
  message,
  showToolDetails,
}: {
  message: ChatMessage;
  showToolDetails: boolean;
}): React.ReactElement {
  const { content, reasoning, toolCalls, tokenUsage } = message;
  const lines = content.split("\n");
  const hasContent = content.trim().length > 0;
  const hasReasoning = !!reasoning;
  const hasToolCalls = toolCalls && toolCalls.length > 0;
  const hasFooter = !!tokenUsage;

  return (
    <Box flexDirection="column" paddingLeft={0} paddingRight={2} marginTop={2}>
      {/* 标题行 */}
      <Box paddingLeft={2}>
        <Text color="cyan">{"│"}</Text>
        <Box paddingLeft={1} paddingRight={1}>
          <Text bold color="cyan">
            Bot ⌘
          </Text>
        </Box>
      </Box>

      {/* 消息体：所有内容共享一条 │ 左边框 */}
      <Box flexDirection="row">
        <Box paddingLeft={2} paddingRight={1}>
          <Text color="cyan">{"│"}</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          {/* 思考过程 + 工具调用（共享折叠逻辑） */}
          {(() => {
            const tc = hasToolCalls
              ? toolCalls![toolCalls!.length - 1]
              : undefined;
            // 展开条件：用户手动展开、工具执行中（无 result）、或错误状态
            const showDetails =
              showToolDetails ||
              (tc && (tc.result === undefined || tc.status === "error"));
            // 折叠时若思考过程或工具调用已完成，显示折叠提示
            const hasFolded =
              !showDetails &&
              (hasReasoning ||
                (tc && tc.result !== undefined && tc.status !== "error"));

            return (
              <>
                {/* 思考过程 — 仅在展开时显示 */}
                {showDetails && hasReasoning && (
                  <Box
                    flexDirection="column"
                    marginBottom={hasToolCalls || hasContent ? 1 : 0}
                  >
                    <Text color="yellow" dimColor>
                      ✱ 思考过程：
                    </Text>
                    <Text dimColor>{truncateReasoning(reasoning!)}</Text>
                  </Box>
                )}

                {/* 工具调用 — 仅渲染最新一条 */}
                {hasToolCalls && tc && (
                  <Box flexDirection="column" marginBottom={hasContent ? 1 : 0}>
                    <Text color="cyan">
                      ☍ {tc.name} <Text dimColor>[{toolCalls!.length}]</Text>
                      {!showDetails && <Text dimColor> Ctrl+T 展开详情</Text>}
                    </Text>
                    {showDetails && (
                      <>
                        <Text dimColor> ∵ {formatArgs(tc.args)}</Text>
                        {tc.result !== undefined && (
                          <Text
                            color={tc.status === "error" ? "red" : undefined}
                            dimColor={tc.status !== "error"}
                          >
                            {"   "}
                            {tc.status === "error" ? "⊘" : "∴"}{" "}
                            {truncateResult(tc.result)}
                          </Text>
                        )}
                      </>
                    )}
                  </Box>
                )}

                {/* 折叠提示：思考过程或工具调用已完成但被收起 */}
                {hasFolded && !hasToolCalls && (
                  <Box flexDirection="column" marginBottom={hasContent ? 1 : 0}>
                    <Text dimColor>✱ 思考过程 Ctrl+T 展开</Text>
                  </Box>
                )}
              </>
            );
          })()}

          {/* 文本回复 */}
          {hasContent &&
            lines.map((line, i) => (
              <Box key={i}>
                <Text>{line || " "}</Text>
              </Box>
            ))}

          {/* token 消耗脚注 */}
          {hasFooter && (
            <Box marginTop={hasContent || hasToolCalls ? 1 : 0}>
              <Text dimColor>
                ── tokens: ↑ {tokenCountToUnit(tokenUsage!.input_tokens)} / ↓{" "}
                {tokenCountToUnit(tokenUsage!.output_tokens)}
              </Text>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

/** 截断过长的思考过程（默认 300 字） */
function truncateReasoning(text: string, maxLen = 300): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + `...（共 ${text.length} 字，已截断）`;
}

/** 格式化工具调用参数为紧凑单行 */
function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return "（无参数）";
  return entries
    .map(([k, v]) => {
      const val = typeof v === "string" ? `"${v}"` : JSON.stringify(v);
      return `${k}: ${val}`;
    })
    .join(", ");
}

/** 截断过长的工具执行结果（默认 500 字） */
function truncateResult(result: string, maxLen = 500): string {
  if (result.length <= maxLen) return result;
  return result.slice(0, maxLen) + `...（共 ${result.length} 字，已截断）`;
}

/** 安全审批确认横幅 — 黄色警告背景，Enter 确认 / Esc 拒绝 */
function ApprovalBanner({
  approval,
  onApproval,
}: {
  approval: PendingApproval;
  onApproval: (decision: "approve" | "reject") => void;
}): React.ReactElement {
  useInput((_input, key) => {
    if (key.return) {
      onApproval("approve");
      return;
    }
    if (key.escape) {
      onApproval("reject");
      return;
    }
    // Y/y 确认，N/n 拒绝
    if (_input.toLowerCase() === "y") {
      onApproval("approve");
      return;
    }
    if (_input.toLowerCase() === "n") {
      onApproval("reject");
      return;
    }
  });

  const argsStr = approval.args.length > 0 ? ` ${approval.args.join(" ")}` : "";

  return (
    <Box
      flexDirection="column"
      marginLeft={1}
      marginRight={1}
      marginBottom={0}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={0}
      paddingBottom={0}
      borderStyle="round"
      borderColor="yellow"
    >
      <Box borderBottom>
        <Text bold color="yellow">
          ⚠️ 安全审批
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text>{approval.message}</Text>
      </Box>
      <Box>
        <Text bold>
          将执行: {approval.command}
          {argsStr}
        </Text>
      </Box>
      <Box marginTop={1} gap={2}>
        <Text color="green">Enter / Y — 确认执行</Text>
        <Text color="red">Esc / N — 拒绝</Text>
      </Box>
    </Box>
  );
}

/**
 * 计算菜单可视切片
 * 保持选中项在可视窗口内
 */
function calcVisibleSlice(
  total: number,
  selected: number,
  max: number,
): { start: number; count: number } {
  if (total <= max) {
    return { start: 0, count: total };
  }

  let start = selected - Math.floor(max / 2);
  if (start < 0) start = 0;
  if (start + max > total) start = total - max;

  return { start, count: max };
}
