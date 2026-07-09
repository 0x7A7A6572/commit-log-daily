import { useState } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { Box, BoxProps, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { readConfig, writeConfig } from '../config/store.js';
import type { ProjectConfig } from '../config/schema.js';

/** 页面模式 */
type Mode = 'list' | 'add-name' | 'add-path' | 'delete-confirm';

interface ProjectsViewProps {
  /** 返回聊天页的回调 */
  onBack: () => void;
}

const modelStyle: BoxProps = {
  borderTop: true,
  borderBottom: false,
  borderLeft: false,
  borderRight: false,
}


/**
 * 项目管理独立页面
 * 键盘操作：
 *   ↑↓  导航项目列表
 *   A   添加项目
 *   D   删除选中项目
 *   Esc 返回聊天
 */
export function ProjectsView({ onBack }: ProjectsViewProps) {
  const [projects, setProjects] = useState<ProjectConfig[]>(() => readConfig().projects);
  const [focusIndex, setFocusIndex] = useState<number>(0);
  const [mode, setMode] = useState<Mode>('list');
  const [newName, setNewName] = useState<string>('');
  const [newPath, setNewPath] = useState<string>('');
  const [statusMsg, setStatusMsg] = useState<string>('');

  /** 重置添加表单 */
  const resetAddForm = () => {
    setNewName('');
    setNewPath('');
    setMode('list');
  };

  /** 保存配置到磁盘 */
  const save = () => {
    try {
      const config = readConfig();
      config.projects = projects;
      writeConfig(config);
      setStatusMsg('已保存');
    } catch (err) {
      setStatusMsg(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  useInput((input, key) => {
    // 添加模式 — 名称输入
    if (mode === 'add-name') {
      if (key.escape) {
        resetAddForm();
        return;
      }
      return; // TextInput 处理输入和回车
    }

    // 添加模式 — 路径输入
    if (mode === 'add-path') {
      if (key.escape) {
        resetAddForm();
        return;
      }
      return; // TextInput 处理输入和回车
    }

    // 删除确认模式
    if (mode === 'delete-confirm') {
      if (input === 'y' || input === 'Y') {
        const updated = projects.filter((_, i) => i !== focusIndex);
        setProjects(updated);
        setStatusMsg('项目已删除');
        saveWithProjects(updated);
        if (focusIndex >= updated.length && updated.length > 0) {
          setFocusIndex(updated.length - 1);
        }
        setMode('list');
        return;
      }
      if (input === 'n' || input === 'N' || key.escape) {
        setMode('list');
        setStatusMsg('');
        return;
      }
      return;
    }

    // 列表模式
    if (key.upArrow) {
      setFocusIndex((prev) => (prev - 1 + Math.max(projects.length, 1)) % Math.max(projects.length, 1));
      return;
    }

    if (key.downArrow) {
      setFocusIndex((prev) => (prev + 1) % Math.max(projects.length, 1));
      return;
    }

    if (input === 'a' || input === 'A') {
      setMode('add-name');
      setNewName('');
      setNewPath('');
      setStatusMsg('');
      return;
    }

    if (input === 'd' || input === 'D') {
      if (projects.length === 0) {
        setStatusMsg('没有可删除的项目');
        return;
      }
      setMode('delete-confirm');
      setStatusMsg('');
      return;
    }

    if (input === 's' || input === 'S') {
      save();
      return;
    }

    if (key.escape) {
      onBack();
      return;
    }
  });

  /** 提交添加 — 校验路径并保存 */
  const submitAdd = () => {
    const absPath = path.resolve(newPath.trim());

    // 校验路径存在
    if (!fs.existsSync(absPath)) {
      setStatusMsg(`路径不存在: ${absPath}`);
      return;
    }

    // 校验是 Git 仓库
    const gitDir = path.join(absPath, '.git');
    if (!fs.existsSync(gitDir)) {
      setStatusMsg(`路径不是 Git 仓库: ${absPath}`);
      return;
    }

    const existing = projects.findIndex((p) => p.name === newName.trim());
    let updated: ProjectConfig[];

    if (existing !== -1) {
      // 更新已有项目
      updated = [...projects];
      updated[existing] = { name: newName.trim(), path: absPath };
      setStatusMsg(`项目 "${newName.trim()}" 已更新`);
    } else {
      // 新增项目
      updated = [...projects, { name: newName.trim(), path: absPath }];
      setStatusMsg(`项目 "${newName.trim()}" 已添加`);
    }

    setProjects(updated);
    saveWithProjects(updated);
    resetAddForm();
  };

  /** 带 projects 的保存 */
  const saveWithProjects = (list: ProjectConfig[]) => {
    try {
      const config = readConfig();
      config.projects = list;
      writeConfig(config);
    } catch {
      // 静默处理，display 操作已成功
    }
  };

  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      {/* 标题栏 */}
      <Box flexDirection="column" backgroundColor="white" marginBottom={1}>
        <Text bold color="black">
          · commit-log-daily · 项目管理
        </Text>
      </Box>
      <Text dimColor>
        ↑↓ 选择  A 添加  D 删除  S 保存  Esc 返回
      </Text>


      {/* 项目列表 */}
      {projects.length === 0 && mode === 'list' && (
        <Box marginTop={1}>
          <Text dimColor>  暂无项目，按 A 添加第一个项目</Text>
        </Box>
      )}

      {projects.length > 0 && (
        <ProjectList projects={projects} focusIndex={focusIndex} />
      )}

      {/* 删除确认 */}
      {mode === 'delete-confirm' && projects[focusIndex] && (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">
            确认删除项目 "{projects[focusIndex]!.name}"？
          </Text>
          <Text dimColor>Y 确认 / N 或 Esc 取消</Text>
        </Box>
      )}

      {/* 添加 — 名称输入 */}
      {mode === 'add-name' && (
        <Box marginTop={1} flexDirection="column" {...modelStyle}  borderStyle="single" >
          <Text bold>添加项目 — 第 1/2 步：输入项目名称</Text>
          <Box marginBottom={1}>
            <Text color="cyan">名称: </Text>
            <TextInput
              value={newName}
              onChange={setNewName}
              onSubmit={() => {
                if (newName.trim()) {
                  setMode('add-path');
                }
              }}
              placeholder="例如: my-project"
            />
          </Box>
          <Text dimColor>回车确认 / Esc 取消</Text>
        </Box>
      )}

      {/* 添加 — 路径输入 */}
      {mode === 'add-path' && (
        <Box marginTop={1} flexDirection="column" {...modelStyle}   borderStyle="single">
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

      {/* 状态消息 */}
      {statusMsg && mode === 'list' && (
        <Box marginTop={1}>
          <Text color={statusMsg.includes('失败') || statusMsg.includes('不存在') || statusMsg.includes('不是 Git') ? 'red' : 'green'}>
            {statusMsg}
          </Text>
        </Box>
      )}

      {/* 添加模式的错误消息 */}
      {(mode === 'add-name' || mode === 'add-path') && statusMsg && (
        <Box marginTop={1}>
          <Text color="red">{statusMsg}</Text>
        </Box>
      )}

      {/* 底部提示 */}
      <Box marginTop={1}>
        <Text dimColor></Text>
      </Box>
    </Box>
  );
}

/** 两列项目列表：名称 | 路径 */
function ProjectList({
  projects,
  focusIndex,
}: {
  projects: ProjectConfig[];
  focusIndex: number;
}) {
  const nameWidth = Math.max(...projects.map((p) => p.name.length), 4);
  const rows = projects.map((p, i) => {
    const isFocused = i === focusIndex;
    const pointer = isFocused ? '❯' : ' ';
    const color = isFocused ? 'cyan' : 'grey';
    const namePadded = p.name.padEnd(nameWidth);

    return (
      <Box key={p.name}>
        <Text color={isFocused ? 'cyan' : undefined}>
          {pointer} {namePadded}
        </Text>
        <Text color={color}>{'  '}{p.path}</Text>
      </Box>
    );
  });

  return <Box flexDirection="column">{rows}</Box>;
}
