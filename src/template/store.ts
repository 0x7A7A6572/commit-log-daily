import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readConfig, writeConfig } from '../config/store.js';

/** 模板文件目录 */
const TEMPLATE_DIR = path.join(os.homedir(), '.commit-log-daily', 'templates');

/** 内置默认模板名（只读，不可更新/删除） */
const BUILTIN_TEMPLATE = 'default';

/** 确保模板目录存在 */
function ensureDir(): void {
  if (!fs.existsSync(TEMPLATE_DIR)) {
    fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
  }
}

/** 模板文件完整路径 */
function templatePath(name: string): string {
  return path.join(TEMPLATE_DIR, `${name}.md`);
}

/** 获取模板文件的完整路径 */
export const getTemplatePath = templatePath;

/** 列出所有模板文件 */
export function listTemplates(): Array<{ filename: string; isDefault: boolean }> {
  ensureDir();
  const config = readConfig();
  const defaultName = config.report.template;

  const entries: Array<{ filename: string; isDefault: boolean }> = [];

  // 内置 default 始终在列表中
  entries.push({ filename: BUILTIN_TEMPLATE, isDefault: defaultName === BUILTIN_TEMPLATE });

  // 扫描 .md 文件（排除内置 default，它不对应实际文件）
  if (fs.existsSync(TEMPLATE_DIR)) {
    const files = fs.readdirSync(TEMPLATE_DIR);
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      const name = f.slice(0, -3);
      if (name === BUILTIN_TEMPLATE) continue;
      entries.push({ filename: name, isDefault: defaultName === name });
    }
  }

  return entries;
}

/** 读取模板文件内容 */
export function readTemplate(name: string): string {
  // 内置 default 返回空字符串（调用方应使用 GENERATE_SYSTEM_PROMPT）
  if (name === BUILTIN_TEMPLATE) {
    return '';
  }

  ensureDir();
  const filePath = templatePath(name);

  if (!fs.existsSync(filePath)) {
    throw new Error(`模板 "${name}" 不存在`);
  }

  return fs.readFileSync(filePath, 'utf-8');
}

/** 创建新模板文件 */
export function createTemplate(name: string, content: string): void {
  if (name === BUILTIN_TEMPLATE) {
    throw new Error(`"${BUILTIN_TEMPLATE}" 是内置模板，不可创建`);
  }

  ensureDir();
  const filePath = templatePath(name);

  if (fs.existsSync(filePath)) {
    throw new Error(`模板 "${name}" 已存在，请使用 updateTemplate 更新`);
  }

  fs.writeFileSync(filePath, content, 'utf-8');
}

/** 更新模板文件内容 */
export function updateTemplate(name: string, content: string): void {
  if (name === BUILTIN_TEMPLATE) {
    throw new Error(`"${BUILTIN_TEMPLATE}" 是内置默认模板，不可更新`);
  }

  ensureDir();
  const filePath = templatePath(name);

  if (!fs.existsSync(filePath)) {
    throw new Error(`模板 "${name}" 不存在`);
  }

  fs.writeFileSync(filePath, content, 'utf-8');
}

/** 删除模板文件 */
export function deleteTemplate(name: string): void {
  if (name === BUILTIN_TEMPLATE) {
    throw new Error(`"${BUILTIN_TEMPLATE}" 是内置默认模板，不可删除`);
  }

  const filePath = templatePath(name);

  if (!fs.existsSync(filePath)) {
    throw new Error(`模板 "${name}" 不存在`);
  }

  fs.unlinkSync(filePath);
}

/** 设置默认模板（持久化到 config.json） */
export function setDefaultTemplate(name: string): void {
  // 内置 default 或实际存在的模板文件都可以
  if (name !== BUILTIN_TEMPLATE) {
    const filePath = templatePath(name);
    if (!fs.existsSync(filePath)) {
      throw new Error(`模板 "${name}" 不存在`);
    }
  }

  const config = readConfig();
  config.report.template = name;
  writeConfig(config);
}

/** 新建模板文件时写入的预制内容 */
const NEW_TEMPLATE_CONTENT = `<!-- 以上部分写 Prompt 指令，告诉 LLM 怎么写（风格、人称、约束等） -->

<!-- DATA -->

<!-- 以下部分写 Markdown 骨架，LLM 以此结构生成报告 -->
<!-- 可用占位符：{{reportType}} {{dateRange}} {{author.name}}
     循环：{{#projects}} {{projectName}} {{commitCount}} {{#commits}} {{message}} {{/commits}} {{/projects}} -->

# {{author.name}} 的{{reportType}}

**时间范围**：{{dateRange}}

## 核心产出
{{#projects}}
### {{projectName}}（{{commitCount}} 次提交）
{{#commits}}
- {{message}}
{{/commits}}
{{/projects}}

## 下一步计划
<!-- LLM 根据上下文推断 -->
`;

/** 创建带预制格式的空白模板文件 */
export function createEmptyTemplate(name: string): void {
  if (name === BUILTIN_TEMPLATE) {
    throw new Error(`"${BUILTIN_TEMPLATE}" 是内置模板，不可创建`);
  }

  ensureDir();
  const filePath = templatePath(name);

  if (fs.existsSync(filePath)) {
    throw new Error(`模板 "${name}" 已存在，请按 E 编辑`);
  }

  fs.writeFileSync(filePath, NEW_TEMPLATE_CONTENT, 'utf-8');
}

/** 导出模板目录路径，供 resolver 使用 */
export { TEMPLATE_DIR };
