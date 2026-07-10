import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { readConfig, writeConfig } from "../config/store.js";
import type { AppConfig } from "../config/schema.js";
import { VERSION } from "../version.js";

/** 更新检查状态 */
type UpdateStatus = "idle" | "checking" | "up-to-date" | "update-available" | "error";

/** 配置页焦点区域 */
type FocusArea =
  | "model-baseUrl"
  | "model-model"
  | "model-apiKey"
  | "author-name"
  | "author-email"
  | "outputDir"
  | "safety-safeMode";

/** 所有焦点的顺序列表 */
const FOCUS_ORDER: FocusArea[] = [
  "model-baseUrl",
  "model-model",
  "model-apiKey",
  "author-name",
  "author-email",
  "outputDir",
  "safety-safeMode",
];

interface ConfigViewProps {
  /** 关闭配置页的回调 */
  onClose: () => void;
}

/**
 * 独立配置页
 * 用户通过 /config 斜杠命令进入，Esc 返回
 */
export function ConfigView({ onClose }: ConfigViewProps) {
  const [config, setConfig] = useState<AppConfig>(() => readConfig());
  const [focusIndex, setFocusIndex] = useState<number>(0);
  const [editing, setEditing] = useState<boolean>(false);
  const [editValue, setEditValue] = useState<string>("");
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [latestVersion, setLatestVersion] = useState<string>("");

  // 检查更新
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      setUpdateStatus("checking");
      try {
        const res = await fetch("https://registry.npmjs.org/commit-log-daily", {
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { "dist-tags"?: { latest?: string } };
        const latest = data["dist-tags"]?.latest;
        if (!latest) throw new Error("No latest tag");
        if (cancelled) return;
        setLatestVersion(latest);
        setUpdateStatus(VERSION === latest ? "up-to-date" : "update-available");
      } catch {
        if (!cancelled) setUpdateStatus("error");
      }
    };
    check();
    return () => { cancelled = true; };
  }, []);

  const currentFocus = FOCUS_ORDER[focusIndex]!;

  useInput((input, key) => {
    // 编辑模式
    if (editing) {
      if (key.return) {
        // 回车：应用编辑并自动保存
        const updated = applyEdit(config, currentFocus, editValue, setConfig);
        try {
          writeConfig(updated);
          setStatusMsg("已保存");
        } catch (err) {
          setStatusMsg(
            `保存失败: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        setEditing(false);
        return;
      }
      return; // 编辑中，由 TextInput 处理输入
    }

    // 导航模式
    if (currentFocus === "safety-safeMode" && input === " ") {
      // Space 切换安全模式
      const updated = { ...config, safety: { ...config.safety, safeMode: !config.safety.safeMode } };
      setConfig(updated);
      try {
        writeConfig(updated);
        setStatusMsg("已保存");
      } catch (err) {
        setStatusMsg(
          `保存失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return;
    }

    if (input === "e") {
      // Enter 键进入编辑
      const currentValue = getFieldValue(config, currentFocus);
      setEditValue(currentValue);
      setEditing(true);
      setStatusMsg("");
      return;
    }

    if (key.upArrow) {
      setFocusIndex(
        (prev) => (prev - 1 + FOCUS_ORDER.length) % FOCUS_ORDER.length,
      );
      return;
    }

    if (key.downArrow) {
      setFocusIndex((prev) => (prev + 1) % FOCUS_ORDER.length);
      return;
    }

    if (key.escape) {
      onClose();
      return;
    }

    if (input === "s") {
      // Ctrl+S 保存
      try {
        writeConfig(config);
        setStatusMsg("已保存");
      } catch (err) {
        setStatusMsg(
          `保存失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1} minHeight={24}>
      {/* 标题栏 */}
      <Box flexDirection="column" backgroundColor="white" marginBottom={1}>
        <Text bold color="black">
          · commit-log-daily v{VERSION} · 配置
        </Text>
      </Box>
      <Text dimColor >↑↓ 选择 · E 编辑 · Space 切换开关 · Enter 确认并保存 · Esc 返回</Text>

      {/* 配置表单 */}
      <Box flexDirection="column" padding={1}>
        {/* 模型配置 */}
        <SectionTitle title="大模型" />
        <ConfigField
          label="Base URL"
          value={config.model.baseUrl}
          focused={currentFocus === "model-baseUrl"}
          editing={editing && currentFocus === "model-baseUrl"}
          editValue={editValue}
          onChangeEdit={setEditValue}
        />
        <ConfigField
          label="Model"
          value={config.model.model}
          focused={currentFocus === "model-model"}
          editing={editing && currentFocus === "model-model"}
          editValue={editValue}
          onChangeEdit={setEditValue}
        />
        <ConfigField
          label="API Key"
          value={maskForDisplay(config.model.apiKey)}
          focused={currentFocus === "model-apiKey"}
          editing={editing && currentFocus === "model-apiKey"}
          editValue={editValue}
          onChangeEdit={setEditValue}
          sensitive={true}
        />

        {/* 作者配置 */}
        <SectionTitle title="Git 作者" />
        <ConfigField
          label="git user.name"
          value={config.author.name || "(未配置)"}
          focused={currentFocus === "author-name"}
          editing={editing && currentFocus === "author-name"}
          editValue={editValue}
          onChangeEdit={setEditValue}
        />
        <ConfigField
          label="git user.email"
          value={config.author.email || "(未配置)"}
          focused={currentFocus === "author-email"}
          editing={editing && currentFocus === "author-email"}
          editValue={editValue}
          onChangeEdit={setEditValue}
        />

        {/* 输出目录 */}
        <SectionTitle title="报告输出" />
        <ConfigField
          label="outputDir"
          value={config.report.outputDir || "(当前目录)"}
          focused={currentFocus === "outputDir"}
          editing={editing && currentFocus === "outputDir"}
          editValue={editValue}
          onChangeEdit={setEditValue}
        />

        {/* 安全配置 */}
        <SectionTitle title="安全" />
        <ConfigField
          label="Safe Mode"
          value={config.safety.safeMode ? "✅ 已开启（仅允许只读命令）" : "⚠️ 已关闭（允许所有命令）"}
          focused={currentFocus === "safety-safeMode"}
          editing={false}
          editValue=""
          onChangeEdit={() => {}}
        />
        <Box marginLeft={1}>
          <Text dimColor>
            {currentFocus === "safety-safeMode"
              ? "按 Space 切换 · 开启后仅允许白名单 Git/系统命令"
              : "安全模式控制 Git 和系统命令的白名单限制"}
          </Text>
        </Box>
      </Box>

      {/* 状态消息 */}
      {statusMsg ? (
        <Box marginTop={1}>
          <Text color={statusMsg.startsWith("保存失败") ? "red" : "green"}>
            {statusMsg}
          </Text>
        </Box>
      ) : null}

      {/* 关于 */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="grey"
        marginTop={1}
        paddingLeft={1}
        paddingRight={1}
      >
        <Box>
          <Text bold>commit-log-daily </Text>
          <Text dimColor>v{VERSION}</Text>
        </Box>
        <Box>
          <Text dimColor>开发者日报/周报智能体 · AI-powered Git 提交聚合工具</Text>
        </Box>
        <Box>
          <UpdateStatusText status={updateStatus} latest={latestVersion} current={VERSION} />
        </Box>
        <Box marginTop={1}>
          <Text color="grey">
            npm i -g commit-log-daily · pnpm build && node bin/agent.js
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

/** 区块标题 */
function SectionTitle({ title }: { title: string }) {
  return (
    <Box marginTop={1} marginLeft={1}>
      <Text bold backgroundColor="grey" color="white">
        {title}
      </Text>
    </Box>
  );
}

/** 单个配置字段 */
function ConfigField(props: {
  label: string;
  value: string;
  focused: boolean;
  editing: boolean;
  editValue: string;
  onChangeEdit: (v: string) => void;
  sensitive?: boolean;
}) {
  const pointer = props.focused ? "❯" : " ";
  const labelColor = props.focused ? "cyan" : "white";
  const valueColor = props.focused ? undefined : "grey";

  if (props.editing) {
    return (
      <Box>
        <Text color={labelColor}>
          {pointer} {props.label}:{" "}
        </Text>
        <TextInput
          value={props.editValue}
          onChange={props.onChangeEdit}
          placeholder={props.sensitive ? "输入 API Key..." : ""}
        />
      </Box>
    );
  }

  return (
    <Box>
      <Text color={labelColor}>
        {pointer} {props.label}:{" "}
      </Text>
      <Text color={valueColor}>{props.value}</Text>
    </Box>
  );
}

/**
 * 从配置中读取当前焦点字段的值（不含脱敏）
 */
function getFieldValue(config: AppConfig, focus: FocusArea): string {
  const fieldMap: Record<FocusArea, string> = {
    "model-baseUrl": config.model.baseUrl,
    "model-model": config.model.model,
    "model-apiKey": config.model.apiKey,
    "author-name": config.author.name,
    "author-email": config.author.email,
    outputDir: config.report.outputDir,
    "safety-safeMode": config.safety.safeMode ? "true" : "false",
  };
  return fieldMap[focus];
}

/**
 * 应用编辑到配置对象，返回更新后的配置
 */
function applyEdit(
  config: AppConfig,
  focus: FocusArea,
  value: string,
  setConfig: (c: AppConfig) => void,
): AppConfig {
  const updated = { ...config };
  switch (focus) {
    case "model-baseUrl":
      updated.model = { ...updated.model, baseUrl: value };
      break;
    case "model-model":
      updated.model = { ...updated.model, model: value };
      break;
    case "model-apiKey":
      updated.model = { ...updated.model, apiKey: value };
      break;
    case "author-name":
      updated.author = { ...updated.author, name: value };
      break;
    case "author-email":
      updated.author = { ...updated.author, email: value };
      break;
    case "outputDir":
      updated.report = { ...updated.report, outputDir: value };
      break;
    case "safety-safeMode":
      updated.safety = { ...updated.safety, safeMode: value === "true" };
      break;
  }
  setConfig(updated);
  return updated;
}

/** 展示用脱敏 */
function maskForDisplay(key: string): string {
  if (!key) return "(未配置)";
  if (key.length <= 6) return "****";
  return `${key.slice(0, 3)}${"*".repeat(key.length - 6)}${key.slice(-3)}`;
}

/** 更新状态展示 */
function UpdateStatusText({
  status,
  latest,
  current,
}: {
  status: UpdateStatus;
  latest: string;
  current: string;
}) {
  switch (status) {
    case "checking":
      return <Text dimColor>⏳ 正在检查更新…</Text>;
    case "up-to-date":
      return <Text color="green">✓ 已是最新版本</Text>;
    case "update-available":
      return (
        <Box flexDirection="column">
          <Text color="yellow">
            ⚡ 有新版本可用：v{latest}（当前：v{current}）
          </Text>
          <Text dimColor>{"  npm i -g commit-log-daily@latest  →  升级"}</Text>
        </Box>
      );
    case "error":
      return <Text dimColor>⚠ 检查更新失败（无法访问 npm registry）</Text>;
    default:
      return null;
  }
}
