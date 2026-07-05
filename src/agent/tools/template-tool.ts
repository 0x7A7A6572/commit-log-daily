import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  listTemplates as listTemplatesFn,
  readTemplate as readTemplateFn,
  createTemplate as createTemplateFn,
  updateTemplate as updateTemplateFn,
  deleteTemplate as deleteTemplateFn,
  setDefaultTemplate as setDefaultTemplateFn,
} from '../../template/store.js';

/** 列出所有模板文件 */
export const listTemplatesTool = tool(
  async () => {
    const list = listTemplatesFn();
    if (list.length === 0) {
      return '当前没有可用的模板文件。';
    }
    const lines = list.map(
      (t) => `- ${t.filename}${t.isDefault ? ' (默认)' : ''}`,
    );
    return `可用模板（共 ${list.length} 个）：\n${lines.join('\n')}`;
  },
  {
    name: 'listTemplates',
    description: '列出所有可用的报告模板文件，标注当前默认模板。',
    schema: z.object({}),
  },
);

/** 读取指定模板的完整内容 */
export const readTemplateTool = tool(
  async ({ template: name }) => {
    try {
      const content = readTemplateFn(name);
      if (content === '') {
        return `"${name}" 是内置默认模板。其内容为系统预设的报告格式（核心产出、问题修复、技术优化、其他工作、下一步计划），不可直接编辑。如需自定义，请使用 createTemplate 创建新模板。`;
      }
      return `模板 "${name}" 的内容：\n\n${content}`;
    } catch (err) {
      return `读取失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: 'readTemplate',
    description: '读取指定模板文件的完整内容，包括 Prompt 指令段和 Markdown 骨架段。',
    schema: z.object({
      template: z.string().describe('模板文件名，不含 .md 扩展名'),
    }),
  },
);

/** 创建新模板文件 */
export const createTemplateTool = tool(
  async ({ template: name, content }) => {
    try {
      createTemplateFn(name, content);
      return `模板 "${name}" 已创建。`;
    } catch (err) {
      return `创建失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: 'createTemplate',
    description:
      '创建一个新的报告模板文件。模板内容分为两段：<!-- DATA --> 之上是 Prompt 指令（告诉 LLM 怎么写），之下是 Markdown 骨架（报告结构参考）。如果不写 <!-- DATA -->，整个内容视为骨架。',
    schema: z.object({
      template: z.string().describe('模板文件名，不含 .md 扩展名'),
      content: z.string().describe('模板完整内容，Prompt 指令段 + <!-- DATA --> + Markdown 骨架段'),
    }),
  },
);

/** 更新已有模板 */
export const updateTemplateTool = tool(
  async ({ template: name, content }) => {
    try {
      updateTemplateFn(name, content);
      return `模板 "${name}" 已更新。`;
    } catch (err) {
      return `更新失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: 'updateTemplate',
    description:
      '更新已有模板文件的内容。注意：内置 default 模板不可更新，需要先创建自定义模板。',
    schema: z.object({
      template: z.string().describe('模板文件名，不含 .md 扩展名'),
      content: z.string().describe('模板完整新内容'),
    }),
  },
);

/** 删除模板 */
export const deleteTemplateTool = tool(
  async ({ template: name }) => {
    try {
      deleteTemplateFn(name);
      return `模板 "${name}" 已删除。`;
    } catch (err) {
      return `删除失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: 'deleteTemplate',
    description: '删除一个模板文件。注意：内置 default 模板不可删除。',
    schema: z.object({
      template: z.string().describe('要删除的模板文件名，不含 .md 扩展名'),
    }),
  },
);

/** 设置默认模板 */
export const setDefaultTemplateTool = tool(
  async ({ template: name }) => {
    try {
      setDefaultTemplateFn(name);
      return `已将默认模板设置为 "${name}"。后续生成报告时将使用此模板。`;
    } catch (err) {
      return `设置失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: 'setDefaultTemplate',
    description: '设置默认报告模板。后续所有报告生成都将使用此模板（也可在对话中临时切换）。',
    schema: z.object({
      template: z.string().describe('模板文件名，不含 .md 扩展名。设为 "default" 恢复系统默认格式。'),
    }),
  },
);
