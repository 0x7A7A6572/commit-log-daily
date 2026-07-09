import { useState } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { readConfig, writeConfig } from '../config/store.js';
import type { ProjectConfig } from '../config/schema.js';
import { SettingsPage } from './components/SettingsPage.js';

/** 页面模式 */
type Mode = 'list' | 'add-name' | 'add-path';

interface ProjectsViewProps {
  /** 返回聊天页的回调 */
  onBack: () => void;
  /** 选中项目查看详情的回调 */
  onSelect: (name: string, path: string) => void;
}

/**
 * 项目管理独立页面
 * 使用 SettingsPage 列表模式提供搜索 + 分页 + 键盘导航
 */
export function ProjectsView({ onBack, onSelect }: ProjectsViewProps) {
  const [projects, setProjects] = useState<ProjectConfig[]>(() => readConfig().projects);
  const [mode, setMode] = useState<Mode>('list');
  const [newName, setNewName] = useState('');
  const [newPath, setNewPath] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  /** 重置添加表单 */
  const resetAddForm = () => {
    setNewName('');
    setNewPath('');
    setMode('list');
  };

  /** 保存配置 */
  const save = (list?: ProjectConfig[]) => {
    try {
      const config = readConfig();
      config.projects = list ?? projects;
      writeConfig(config);
      setStatusMsg('已保存');
    } catch (err) {
      setStatusMsg(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /** 提交添加 — 校验路径并保存 */
  const submitAdd = () => {
    const absPath = path.resolve(newPath.trim());

    if (!fs.existsSync(absPath)) {
      setStatusMsg(`路径不存在: ${absPath}`);
      return;
    }

    const gitDir = path.join(absPath, '.git');
    if (!fs.existsSync(gitDir)) {
      setStatusMsg(`路径不是 Git 仓库: ${absPath}`);
      return;
    }

    const existing = projects.findIndex((p) => p.name === newName.trim());
    let updated: ProjectConfig[];

    if (existing !== -1) {
      updated = [...projects];
      updated[existing] = { name: newName.trim(), path: absPath };
      setStatusMsg(`项目 "${newName.trim()}" 已更新`);
    } else {
      updated = [...projects, { name: newName.trim(), path: absPath }];
      setStatusMsg(`项目 "${newName.trim()}" 已添加`);
    }

    setProjects(updated);
    save(updated);
    resetAddForm();
  };

  // 项目名称列宽（用于对齐）
  const nameWidth = Math.max(...projects.map((p) => p.name.length), 4);

  // ── 键盘（仅模态模式）──────────────────────────
  useInput((_input, key) => {
    // 列表模式 — SettingsPage 接管键盘
    if (mode === 'list') return;

    if (key.escape) {
      resetAddForm();
      return;
    }
    // TextInput 处理回车，useInput 无需额外处理
  });

  // ── 添加表单模态 ──────────────────────────────
  if (mode === 'add-name' || mode === 'add-path') {
    return (
      <SettingsPage
        title="项目管理"
        topHint={<Text dimColor>Esc 返回</Text>}
        bottomHint={statusMsg ? <Text color="red">{statusMsg}</Text> : undefined}
      >
        {mode === 'add-name' && (
          <Box marginTop={1} flexDirection="column" borderStyle="single">
            <Text bold>添加项目 — 第 1/2 步：输入项目名称</Text>
            <Box marginBottom={1}>
              <Text color="cyan">名称: </Text>
              <TextInput
                value={newName}
                onChange={setNewName}
                onSubmit={() => {
                  if (newName.trim()) setMode('add-path');
                }}
                placeholder="例如: my-project"
              />
            </Box>
            <Text dimColor>回车确认 / Esc 取消</Text>
          </Box>
        )}
        {mode === 'add-path' && (
          <Box marginTop={1} flexDirection="column" borderStyle="single">
            <Text bold>添加项目 — 第 2/2 步：输入项目路径</Text>
            <Box marginBottom={1}>
              <Text color="cyan">路径: </Text>
              <TextInput
                value={newPath}
                onChange={setNewPath}
                onSubmit={submitAdd}
                placeholder="例如: /home/user/projects/my-project"
              />
            </Box>
            <Text dimColor>回车确认 / Esc 取消</Text>
          </Box>
        )}
      </SettingsPage>
    );
  }

  // ── 列表模式 ──────────────────────────────────
  return (
    <SettingsPage<ProjectConfig>
      title="项目管理"
      emptyText="暂无项目，按 A 添加"
      bottomHint={
        deleteConfirm ? (
          <Text color="red">确认删除？再按一次 d 确认，其他键取消</Text>
        ) : statusMsg ? (
          <Text color={statusMsg.includes('失败') || statusMsg.includes('不存在') ? 'red' : 'green'}>
            {statusMsg}
          </Text>
        ) : undefined
      }
      listMode={{
        items: projects,
        getKey: (p) => p.name,
        renderItem: (project, _index, isFocused) => {
          const pointer = isFocused ? '❯' : ' ';
          const color = isFocused ? 'cyan' : 'grey';
          const namePadded = project.name.padEnd(nameWidth);

          return (
            <Text>
              <Text color={isFocused ? 'cyan' : undefined}>{pointer} {namePadded}</Text>
              <Text color={color}>{'  '}{project.path}</Text>
            </Text>
          );
        },
        onSelect: (project) => {
          onSelect(project.name, project.path);
        },
        onBack,
        search: {
          placeholder: '搜索项目…',
          filter: (project, query) => {
            const q = query.toLowerCase();
            return project.name.toLowerCase().includes(q) || project.path.toLowerCase().includes(q);
          },
        },
        extraKeys: [
          {
            key: 'a',
            label: '添加',
            handler: () => {
              setMode('add-name');
              setNewName('');
              setNewPath('');
              setStatusMsg('');
              setDeleteConfirm(false);
            },
          },
          {
            key: 'd',
            label: '删除',
            handler: (ctx) => {
              if (!ctx.focusedItem) return;
              setStatusMsg('');
              if (deleteConfirm) {
                const updated = projects.filter((p) => p.name !== ctx.focusedItem!.name);
                setProjects(updated);
                save(updated);
                setDeleteConfirm(false);
              } else {
                setDeleteConfirm(true);
              }
            },
          },
          {
            key: 's',
            label: '保存',
            handler: () => {
              save();
              setDeleteConfirm(false);
            },
          },
        ],
      }}
    />
  );
}
