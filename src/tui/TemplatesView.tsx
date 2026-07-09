import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import {
  listTemplates,
  readTemplate,
  deleteTemplate as deleteTemplateFn,
  setDefaultTemplate as setDefaultFn,
  createEmptyTemplate,
  getTemplatePath,
} from '../template/store.js';
import { openInEditor } from '../shared/editor.js';
import { SettingsPage } from './components/SettingsPage.js';

/** 模板元数据 */
interface TemplateMeta {
  filename: string;
  isDefault: boolean;
}

/** 页面模式 */
type Mode = 'list' | 'preview' | 'new-filename';

interface TemplatesViewProps {
  onBack: () => void;
}

/**
 * 模板管理独立页面
 * 使用 SettingsPage 列表模式提供搜索 + 分页 + 键盘导航
 */
export function TemplatesView({ onBack }: TemplatesViewProps) {
  const [templates, setTemplates] = useState<TemplateMeta[]>(() => listTemplates());
  const [mode, setMode] = useState<Mode>('list');
  const [previewContent, setPreviewContent] = useState('');
  const [selectedFilename, setSelectedFilename] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [newFilename, setNewFilename] = useState('');

  const refreshList = () => {
    setTemplates(listTemplates());
  };

  /** 打开外部编辑器编辑指定模板 */
  const doEdit = (filename: string) => {
    if (filename === 'default') {
      setStatusMsg('内置模板不可编辑，请新建自定义模板');
      return;
    }

    const filePath = getTemplatePath(filename);
    openInEditor(filePath)
      .then(() => setStatusMsg('编辑完成，请按 R 刷新'))
      .catch((err: unknown) =>
        setStatusMsg(`编辑失败: ${err instanceof Error ? err.message : String(err)}`),
      );
  };

  /** 新建模板：确认文件名后创建并打开编辑器 */
  const handleNewSubmit = (value: string) => {
    const trimmed = value.trim();

    if (!trimmed) {
      setStatusMsg('模板名不能为空');
      setMode('list');
      return;
    }

    if (trimmed === 'default') {
      setStatusMsg('"default" 是内置模板名，不能使用此名称');
      setMode('list');
      return;
    }

    try {
      createEmptyTemplate(trimmed);
    } catch (err) {
      setStatusMsg(`创建失败: ${err instanceof Error ? err.message : String(err)}`);
      setMode('list');
      return;
    }

    refreshList();
    setMode('list');

    const filePath = getTemplatePath(trimmed);
    openInEditor(filePath)
      .then(() => setStatusMsg(`模板 "${trimmed}" 已创建，编辑完成请按 R 刷新`))
      .catch((err: unknown) =>
        setStatusMsg(`编辑器启动失败: ${err instanceof Error ? err.message : String(err)}`),
      );
  };

  // ── 键盘（仅模态模式）──────────────────────────
  useInput((input, key) => {
    // 列表模式 — SettingsPage 接管键盘
    if (mode === 'list') return;

    // 新建文件名模式 — TextInput 处理输入
    if (mode === 'new-filename') {
      if (key.escape) {
        setMode('list');
        setNewFilename('');
        setStatusMsg('');
      }
      return;
    }

    // 预览模式
    if (mode === 'preview') {
      if (key.escape || input === 'b' || input === 'B') {
        setMode('list');
        return;
      }
      if (input === 'e' || input === 'E') {
        doEdit(selectedFilename);
        return;
      }
      return;
    }
  });

  // ── 预览模态 ──────────────────────────────────
  if (mode === 'preview') {
    return (
      <SettingsPage
        title="模板管理"
        bottomHint={
          <Box flexDirection="row" gap={1}>
            <Text dimColor>E 编辑</Text>
            <Text dimColor>|</Text>
            <Text dimColor>B 或 Esc 返回列表</Text>
          </Box>
        }
      >
        <Text bold>模板预览 — {selectedFilename}</Text>
        <Box marginTop={1} flexDirection="column">
          {previewContent.split('\n').map((line, i) => (
            <Text key={i}>{line || ' '}</Text>
          ))}
        </Box>
      </SettingsPage>
    );
  }

  // ── 新建文件名模态 ────────────────────────────
  if (mode === 'new-filename') {
    return (
      <SettingsPage title="模板管理">
        <Text bold>新建模板 — 输入文件名（不含 .md 扩展名）：</Text>
        <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingLeft={1}>
          <TextInput
            value={newFilename}
            onChange={setNewFilename}
            onSubmit={handleNewSubmit}
            placeholder=" 输入模板名…"
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Enter 确认 / Esc 取消</Text>
        </Box>
      </SettingsPage>
    );
  }

  // ── 列表模式 ──────────────────────────────────
  return (
    <SettingsPage<TemplateMeta>
      title="模板管理"
      emptyText="暂无模板文件。按 N 新建，或在 ~/.commit-log-daily/templates/ 下创建 .md 文件。"
      bottomHint={
        deleteConfirm ? (
          <Text color="red">确认删除？再按一次 d 确认，其他键取消</Text>
        ) : statusMsg ? (
          <Text
            color={
              statusMsg.includes('失败') ||
              statusMsg.includes('不可') ||
              statusMsg.includes('不能')
                ? 'red'
                : 'green'
            }
          >
            {statusMsg}
          </Text>
        ) : undefined
      }
      listMode={{
        items: templates,
        getKey: (t) => t.filename,
        renderItem: (tmpl, _index, isFocused) => {
          const pointer = isFocused ? '❯' : ' ';
          const color = isFocused ? 'cyan' : undefined;
          const isBuiltin = tmpl.filename === 'default';

          return (
            <Text>
              <Text color={color}>
                {pointer} {tmpl.filename}
                {tmpl.isDefault ? ' [当前]' : ''}
              </Text>
              {isBuiltin && (
                <Text>
                  {' · '}
                  <Text dimColor>内置</Text>
                </Text>
              )}
            </Text>
          );
        },
        onSelect: (tmpl) => {
          // Enter 预览模板内容
          try {
            const content = readTemplate(tmpl.filename);
            setPreviewContent(
              content || '(内置默认模板 — 核心产出、问题修复、技术优化、其他工作、下一步计划)',
            );
            setSelectedFilename(tmpl.filename);
            setMode('preview');
            setStatusMsg('');
            setDeleteConfirm(false);
          } catch (err) {
            setStatusMsg(`预览失败: ${err instanceof Error ? err.message : String(err)}`);
          }
        },
        onBack,
        search: {
          placeholder: '搜索模板…',
          filter: (tmpl, query) => tmpl.filename.toLowerCase().includes(query.toLowerCase()),
        },
        extraKeys: [
          {
            key: 'v',
            label: '预览',
            handler: (ctx) => {
              const tmpl = ctx.focusedItem;
              if (!tmpl) return;
              try {
                const content = readTemplate(tmpl.filename);
                setPreviewContent(
                  content || '(内置默认模板 — 核心产出、问题修复、技术优化、其他工作、下一步计划)',
                );
                setSelectedFilename(tmpl.filename);
                setMode('preview');
                setStatusMsg('');
                setDeleteConfirm(false);
              } catch (err) {
                setStatusMsg(`预览失败: ${err instanceof Error ? err.message : String(err)}`);
              }
            },
          },
          {
            key: 'e',
            label: '编辑',
            handler: (ctx) => {
              const tmpl = ctx.focusedItem;
              if (!tmpl) return;
              setDeleteConfirm(false);
              doEdit(tmpl.filename);
            },
          },
          {
            key: 'n',
            label: '新建',
            handler: () => {
              setNewFilename('');
              setMode('new-filename');
              setStatusMsg('');
              setDeleteConfirm(false);
            },
          },
          {
            key: 'd',
            label: '删除',
            handler: (ctx) => {
              const tmpl = ctx.focusedItem;
              if (!tmpl) return;
              if (tmpl.filename === 'default') {
                setStatusMsg('内置 default 模板不可删除');
                setDeleteConfirm(false);
                return;
              }
              setStatusMsg('');
              if (deleteConfirm) {
                try {
                  deleteTemplateFn(tmpl.filename);
                  setStatusMsg(`模板 "${tmpl.filename}" 已删除`);
                  refreshList();
                } catch (err) {
                  setStatusMsg(`删除失败: ${err instanceof Error ? err.message : String(err)}`);
                }
                setDeleteConfirm(false);
              } else {
                setDeleteConfirm(true);
              }
            },
          },
          {
            key: 's',
            label: '设为默认',
            handler: (ctx) => {
              const tmpl = ctx.focusedItem;
              if (!tmpl) return;
              try {
                setDefaultFn(tmpl.filename);
                setStatusMsg(`已将默认模板设为 "${tmpl.filename}"`);
                setDeleteConfirm(false);
                refreshList();
              } catch (err) {
                setStatusMsg(`设置失败: ${err instanceof Error ? err.message : String(err)}`);
              }
            },
          },
          {
            key: 'r',
            label: '刷新',
            handler: () => {
              refreshList();
              setStatusMsg('列表已刷新');
              setDeleteConfirm(false);
            },
          },
        ],
      }}
    />
  );
}
