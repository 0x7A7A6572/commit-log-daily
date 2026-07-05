import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { readConfig, writeConfig } from '../config/store.js';
import type { AppConfig } from '../config/schema.js';

/** 配置页焦点区域 */
type FocusArea = 'model-baseUrl' | 'model-model' | 'model-apiKey' | 'author-name' | 'author-email' | 'outputDir';

/** 所有焦点的顺序列表 */
const FOCUS_ORDER: FocusArea[] = [
  'model-baseUrl',
  'model-model',
  'model-apiKey',
  'author-name',
  'author-email',
  'outputDir',
];

interface ConfigViewProps {
  /** 关闭配置页的回调 */
  onClose: () => void;
}

/**
 * 独立配置页
 * 用户按 Ctrl+E 进入，Esc 返回
 */
export function ConfigView({ onClose }: ConfigViewProps) {
  const [config, setConfig] = useState<AppConfig>(() => readConfig());
  const [focusIndex, setFocusIndex] = useState<number>(0);
  const [editing, setEditing] = useState<boolean>(false);
  const [editValue, setEditValue] = useState<string>('');
  const [statusMsg, setStatusMsg] = useState<string>('');

  const currentFocus = FOCUS_ORDER[focusIndex]!;

  useInput((input, key) => {
    // 编辑模式
    if (editing) {
      if (key.return) {
        // 回车：保存编辑
        setStatusMsg('');
        applyEdit(config, currentFocus, editValue, setConfig, setStatusMsg);
        setEditing(false);
        return;
      }
      return; // 编辑中，由 TextInput 处理输入
    }

    // 导航模式
    if (input === 'e') {
      // Enter 键进入编辑
      const currentValue = getFieldValue(config, currentFocus);
      setEditValue(currentValue);
      setEditing(true);
      setStatusMsg('');
      return;
    }

    if (key.upArrow) {
      setFocusIndex((prev) => (prev - 1 + FOCUS_ORDER.length) % FOCUS_ORDER.length);
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

    if (input === 's') {
      // Ctrl+S 保存
      try {
        writeConfig(config);
        setStatusMsg('已保存');
      } catch (err) {
        setStatusMsg(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          配置页
        </Text>
        <Text dimColor>
          {' '}
          | ↑↓ 导航 | E 编辑 | S 保存 | Esc 返回
        </Text>
      </Box>

      {/* 模型配置 */}
      <SectionTitle title="大模型" />
      <ConfigField
        label="Base URL"
        value={config.model.baseUrl}
        focused={currentFocus === 'model-baseUrl'}
        editing={editing && currentFocus === 'model-baseUrl'}
        editValue={editValue}
        onChangeEdit={setEditValue}
      />
      <ConfigField
        label="Model"
        value={config.model.model}
        focused={currentFocus === 'model-model'}
        editing={editing && currentFocus === 'model-model'}
        editValue={editValue}
        onChangeEdit={setEditValue}
      />
      <ConfigField
        label="API Key"
        value={maskForDisplay(config.model.apiKey)}
        focused={currentFocus === 'model-apiKey'}
        editing={editing && currentFocus === 'model-apiKey'}
        editValue={editValue}
        onChangeEdit={setEditValue}
        sensitive={true}
      />

      {/* 作者配置 */}
      <SectionTitle title="Git 作者" />
      <ConfigField
        label="姓名"
        value={config.author.name || '(未配置)'}
        focused={currentFocus === 'author-name'}
        editing={editing && currentFocus === 'author-name'}
        editValue={editValue}
        onChangeEdit={setEditValue}
      />
      <ConfigField
        label="邮箱"
        value={config.author.email || '(未配置)'}
        focused={currentFocus === 'author-email'}
        editing={editing && currentFocus === 'author-email'}
        editValue={editValue}
        onChangeEdit={setEditValue}
      />

      {/* 输出目录 */}
      <SectionTitle title="报告输出" />
      <ConfigField
        label="输出目录"
        value={config.report.outputDir || '(当前目录)'}
        focused={currentFocus === 'outputDir'}
        editing={editing && currentFocus === 'outputDir'}
        editValue={editValue}
        onChangeEdit={setEditValue}
      />

      {/* 状态消息 */}
      {statusMsg ? (
        <Box marginTop={1}>
          <Text color={statusMsg.startsWith('保存失败') ? 'red' : 'green'}>
            {statusMsg}
          </Text>
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text dimColor>Ctrl+S 保存 | Esc 返回</Text>
      </Box>
    </Box>
  );
}

/** 区块标题 */
function SectionTitle({ title }: { title: string }) {
  return (
    <Box marginTop={1}>
      <Text bold underline>
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
  const pointer = props.focused ? '▸' : ' ';
  const color = props.focused ? 'cyan' : undefined;

  if (props.editing) {
    return (
      <Box>
        <Text color={color}>{pointer} {props.label}: </Text>
        <TextInput
          value={props.editValue}
          onChange={props.onChangeEdit}
          placeholder={props.sensitive ? '输入 API Key...' : ''}
        />
      </Box>
    );
  }

  return (
    <Box>
      <Text color={color}>{pointer} {props.label}: </Text>
      <Text>{props.value}</Text>
    </Box>
  );
}

/** 焦点标签映射 */
const FOCUS_LABELS: Record<FocusArea, string> = {
  'model-baseUrl': 'Base URL',
  'model-model': 'Model',
  'model-apiKey': 'API Key',
  'author-name': '作者姓名',
  'author-email': '作者邮箱',
  'outputDir': '输出目录',
};

/**
 * 从配置中读取当前焦点字段的值（不含脱敏）
 */
function getFieldValue(config: AppConfig, focus: FocusArea): string {
  const fieldMap: Record<FocusArea, string> = {
    'model-baseUrl': config.model.baseUrl,
    'model-model': config.model.model,
    'model-apiKey': config.model.apiKey,
    'author-name': config.author.name,
    'author-email': config.author.email,
    'outputDir': config.report.outputDir,
  };
  return fieldMap[focus];
}

/**
 * 应用编辑到配置对象
 */
function applyEdit(
  config: AppConfig,
  focus: FocusArea,
  value: string,
  setConfig: (c: AppConfig) => void,
  setStatus: (m: string) => void,
): void {
  const updated = { ...config };
  switch (focus) {
    case 'model-baseUrl':
      updated.model = { ...updated.model, baseUrl: value };
      break;
    case 'model-model':
      updated.model = { ...updated.model, model: value };
      break;
    case 'model-apiKey':
      updated.model = { ...updated.model, apiKey: value };
      break;
    case 'author-name':
      updated.author = { ...updated.author, name: value };
      break;
    case 'author-email':
      updated.author = { ...updated.author, email: value };
      break;
    case 'outputDir':
      updated.report = { ...updated.report, outputDir: value };
      break;
  }
  setConfig(updated);
}

/** 展示用脱敏 */
function maskForDisplay(key: string): string {
  if (!key) return '(未配置)';
  if (key.length <= 6) return '****';
  return `${key.slice(0, 3)}${'*'.repeat(key.length - 6)}${key.slice(-3)}`;
}
