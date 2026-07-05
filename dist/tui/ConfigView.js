import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { readConfig, writeConfig } from '../config/store.js';
/** 所有焦点的顺序列表 */
const FOCUS_ORDER = [
    'model-baseUrl',
    'model-model',
    'model-apiKey',
    'author-name',
    'author-email',
    'outputDir',
];
/**
 * 独立配置页
 * 用户按 Ctrl+E 进入，Esc 返回
 */
export function ConfigView({ onClose }) {
    const [config, setConfig] = useState(() => readConfig());
    const [focusIndex, setFocusIndex] = useState(0);
    const [editing, setEditing] = useState(false);
    const [editValue, setEditValue] = useState('');
    const [statusMsg, setStatusMsg] = useState('');
    const currentFocus = FOCUS_ORDER[focusIndex];
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
            }
            catch (err) {
                setStatusMsg(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
            }
            return;
        }
    });
    return (_jsxs(Box, { flexDirection: "column", paddingLeft: 1, paddingRight: 1, children: [_jsxs(Box, { marginBottom: 1, children: [_jsx(Text, { bold: true, color: "cyan", children: "\u914D\u7F6E\u9875" }), _jsxs(Text, { dimColor: true, children: [' ', "| \u2191\u2193 \u5BFC\u822A | E \u7F16\u8F91 | S \u4FDD\u5B58 | Esc \u8FD4\u56DE"] })] }), _jsx(SectionTitle, { title: "\u5927\u6A21\u578B" }), _jsx(ConfigField, { label: "Base URL", value: config.model.baseUrl, focused: currentFocus === 'model-baseUrl', editing: editing && currentFocus === 'model-baseUrl', editValue: editValue, onChangeEdit: setEditValue }), _jsx(ConfigField, { label: "Model", value: config.model.model, focused: currentFocus === 'model-model', editing: editing && currentFocus === 'model-model', editValue: editValue, onChangeEdit: setEditValue }), _jsx(ConfigField, { label: "API Key", value: maskForDisplay(config.model.apiKey), focused: currentFocus === 'model-apiKey', editing: editing && currentFocus === 'model-apiKey', editValue: editValue, onChangeEdit: setEditValue, sensitive: true }), _jsx(SectionTitle, { title: "Git \u4F5C\u8005" }), _jsx(ConfigField, { label: "\u59D3\u540D", value: config.author.name || '(未配置)', focused: currentFocus === 'author-name', editing: editing && currentFocus === 'author-name', editValue: editValue, onChangeEdit: setEditValue }), _jsx(ConfigField, { label: "\u90AE\u7BB1", value: config.author.email || '(未配置)', focused: currentFocus === 'author-email', editing: editing && currentFocus === 'author-email', editValue: editValue, onChangeEdit: setEditValue }), _jsx(SectionTitle, { title: "\u62A5\u544A\u8F93\u51FA" }), _jsx(ConfigField, { label: "\u8F93\u51FA\u76EE\u5F55", value: config.report.outputDir || '(当前目录)', focused: currentFocus === 'outputDir', editing: editing && currentFocus === 'outputDir', editValue: editValue, onChangeEdit: setEditValue }), _jsx(SectionTitle, { title: `项目列表 (${config.projects.length})` }), config.projects.length === 0 ? (_jsx(Text, { dimColor: true, children: "  (\u65E0\u9879\u76EE\uFF0C\u8BF7\u5728\u5BF9\u8BDD\u4E2D\u4F7F\u7528 addProject \u6DFB\u52A0)" })) : (config.projects.map((p) => (_jsxs(Text, { children: ["  ", p.name, " ", '→', " ", p.path] }, p.name)))), statusMsg ? (_jsx(Box, { marginTop: 1, children: _jsx(Text, { color: statusMsg.startsWith('保存失败') ? 'red' : 'green', children: statusMsg }) })) : null, _jsx(Box, { marginTop: 1, children: _jsx(Text, { dimColor: true, children: "Ctrl+S \u4FDD\u5B58 | Esc \u8FD4\u56DE" }) })] }));
}
/** 区块标题 */
function SectionTitle({ title }) {
    return (_jsx(Box, { marginTop: 1, children: _jsx(Text, { bold: true, underline: true, children: title }) }));
}
/** 单个配置字段 */
function ConfigField(props) {
    const pointer = props.focused ? '▸' : ' ';
    const color = props.focused ? 'cyan' : undefined;
    if (props.editing) {
        return (_jsxs(Box, { children: [_jsxs(Text, { color: color, children: [pointer, " ", props.label, ": "] }), _jsx(TextInput, { value: props.editValue, onChange: props.onChangeEdit, placeholder: props.sensitive ? '输入 API Key...' : '' })] }));
    }
    return (_jsxs(Box, { children: [_jsxs(Text, { color: color, children: [pointer, " ", props.label, ": "] }), _jsx(Text, { children: props.value })] }));
}
/** 焦点标签映射 */
const FOCUS_LABELS = {
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
function getFieldValue(config, focus) {
    const fieldMap = {
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
function applyEdit(config, focus, value, setConfig, setStatus) {
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
function maskForDisplay(key) {
    if (!key)
        return '(未配置)';
    if (key.length <= 6)
        return '****';
    return `${key.slice(0, 3)}${'*'.repeat(key.length - 6)}${key.slice(-3)}`;
}
//# sourceMappingURL=ConfigView.js.map