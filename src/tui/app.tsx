import { useState, useEffect } from "react";
import { render, Box, Text, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";

// -- 类型 ----------------------------------------------------------------

type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

// -- 主组件 --------------------------------------------------------------

function AgentApp() {
  const { stdout } = useStdout();
  const [messages, setMessages] = useState<Message[]>([
    { role: "system", content: "👋 欢迎使用 commit-log-daily Agent 模式。输入消息开始对话。" },
  ]);
  const [input, setInput] = useState("");
  const [termHeight, setTermHeight] = useState(() => stdout?.rows ?? 24);

  // 监听终端尺寸变化
  useEffect(() => {
    const onResize = () => setTermHeight(stdout?.rows ?? 24);
    stdout?.on("resize", onResize);
    return () => void stdout?.off("resize", onResize);
  }, [stdout]);

  // 处理回车提交
  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setInput("");

    // 模拟 Agent 响应（后续替换为真正的 AI）
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `收到：「${trimmed}」\n\n这是一个模拟响应。后续将接入 AI Agent 进行实际处理。`,
        },
      ]);
    }, 300);
  };

  // 退出快捷键：Ctrl+C / Ctrl+D
  useInput((input, key) => {
    if (key.ctrl && (input === "c" || input === "d")) {
      process.exit(0);
    }
    // Ctrl+L 清屏
    if (key.ctrl && input === "l") {
      setMessages([]);
    }
  });

  // 计算可见消息：取最近 N 条能显示在当前终端高度的
  const HEADER_LINES = 1; // 顶部标题栏
  const INPUT_LINES = 2; // 输入框 + 分隔线
  const maxMsgLines = Math.max(5, termHeight - HEADER_LINES - INPUT_LINES);
  const visibleMessages = tailByLines(messages, maxMsgLines);

  return (
    <Box flexDirection="column" height={termHeight}>
      {/* 标题栏 */}
      <Box paddingLeft={1} paddingRight={1}>
        <Text bold color="cyan">
          ⚡ commit-log-daily
        </Text>
        <Text dimColor> agent mode | Ctrl+C 退出 | Ctrl+L 清屏</Text>
      </Box>

      {/* 消息区域 */}
      <Box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1}>
        {visibleMessages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}
      </Box>

      {/* 输入区域 */}
      <Box paddingLeft={1} paddingRight={1}>
        <Text color="green" bold>
          ❯{" "}
        </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder="输入消息，回车发送..."
        />
      </Box>
    </Box>
  );
}

// -- 消息气泡 ------------------------------------------------------------

function MessageBubble({ message }: { message: Message }) {
  const color = message.role === "user" ? "green" : message.role === "assistant" ? "blue" : "yellow";

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Text color={color} bold>
        {message.role === "user" ? "▸ 你" : message.role === "assistant" ? "✦ Agent" : "◆ 系统"}
      </Text>
      {message.content.split("\n").map((line, i) => (
        <Text key={i} dimColor={message.role === "system"}>
          {line || " "}
        </Text>
      ))}
    </Box>
  );
}

// -- 工具：按可见行数截取最近消息（简单估算：每条消息约 content 行数 + 1 行 meta） ---

function tailByLines(messages: Message[], maxLines: number): Message[] {
  const result: Message[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const lines = messages[i].content.split("\n").length + 1; // +1 for role label
    if (used + lines > maxLines && result.length > 0) break;
    result.unshift(messages[i]);
    used += lines;
  }
  return result;
}

// -- 入口 ----------------------------------------------------------------

export function startAgentTui(): void {
  render(<AgentApp />);
}
