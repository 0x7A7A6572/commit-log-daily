import fs from 'node:fs';
import path from 'node:path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { readConfig, writeConfig } from '../../config/store.js';
import { AgentToolError } from '../../shared/errors.js';

/** 列出已配置项目的工具 */
export const listProjectsTool = tool(
  async () => {
    const config = readConfig();
    if (config.projects.length === 0) {
      return '当前没有已配置的项目。';
    }
    const lines = config.projects.map(
      (p) => `- ${p.name}: ${p.path}`,
    );
    return `已配置的项目（共 ${config.projects.length} 个）：\n${lines.join('\n')}`;
  },
  {
    name: 'listProjects',
    description: '列出所有已配置的项目及其路径。',
    schema: z.object({}),
  },
);

/** 添加或更新项目的工具 */
export const addProjectTool = tool(
  async ({ name, filePath }) => {
    const absPath = path.resolve(filePath);

    // 校验路径存在
    if (!fs.existsSync(absPath)) {
      throw new AgentToolError(
        `路径不存在: ${absPath}`,
        'addProject',
      );
    }

    // 校验是 Git 仓库
    const gitDir = path.join(absPath, '.git');
    if (!fs.existsSync(gitDir)) {
      throw new AgentToolError(
        `路径不是 Git 仓库: ${absPath}`,
        'addProject',
      );
    }

    const config = readConfig();
    const existing = config.projects.findIndex((p) => p.name === name);

    if (existing !== -1) {
      // 更新已有项目
      config.projects[existing] = { name, path: absPath };
      writeConfig(config);
      return `项目 "${name}" 已更新，路径: ${absPath}`;
    }

    // 新增项目
    config.projects.push({ name, path: absPath });
    writeConfig(config);
    return `项目 "${name}" 已添加，路径: ${absPath}`;
  },
  {
    name: 'addProject',
    description:
      '添加或更新一个项目配置。需要项目名称和绝对路径。路径必须是存在的 Git 仓库。',
    schema: z.object({
      name: z.string().describe('项目名称，用于标识'),
      filePath: z.string().describe('项目的绝对路径或相对路径'),
    }),
  },
);

/** 删除项目的工具 */
export const removeProjectTool = tool(
  async ({ name }) => {
    const config = readConfig();
    const index = config.projects.findIndex((p) => p.name === name);

    if (index === -1) {
      return `未找到名为 "${name}" 的项目，无需删除。`;
    }

    config.projects.splice(index, 1);
    writeConfig(config);
    return `项目 "${name}" 已删除。`;
  },
  {
    name: 'removeProject',
    description: '从配置中删除一个项目。',
    schema: z.object({
      name: z.string().describe('要删除的项目名称'),
    }),
  },
);
