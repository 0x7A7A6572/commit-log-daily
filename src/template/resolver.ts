import { readTemplate } from './store.js';
import { readConfig } from '../config/store.js';

/** 模板解析结果 */
export interface TemplateSections {
  /** Prompt 指令段（<!-- DATA --> 之上），为 null 表示无分隔线 */
  promptSection: string | null;
  /** Markdown 骨架段（<!-- DATA --> 之下） */
  skeletonSection: string;
}

/** 分隔标记 */
const DATA_MARKER = '<!-- DATA -->';

/**
 * 解析模板内容，将 Prompt 段和骨架段分离
 */
function parseTemplate(content: string): TemplateSections {
  const idx = content.indexOf(DATA_MARKER);

  if (idx === -1) {
    // 无分隔线 — 整个文件视为骨架
    return {
      promptSection: null,
      skeletonSection: content.trim(),
    };
  }

  const promptSection = content.slice(0, idx).trim();
  const skeletonSection = content.slice(idx + DATA_MARKER.length).trim();

  return {
    promptSection: promptSection || null,
    skeletonSection: skeletonSection || '',
  };
}

/**
 * 根据当前配置解析模板，返回用于拼入 System Prompt 的文本
 *
 * 返回 null → 使用内置默认模板（调用方应使用 GENERATE_SYSTEM_PROMPT 原文）
 */
export function resolveTemplateForPrompt(): { promptFragment: string; skeletonFragment: string } | null {
  const config = readConfig();
  const templateName = config.report.template;

  // 内置默认模板 — 返回 null
  if (templateName === 'default') {
    return null;
  }

  try {
    const content = readTemplate(templateName);
    const { promptSection, skeletonSection } = parseTemplate(content);

    const promptFragment = promptSection
      ? `---\n模板指令（用户自定义）:\n${promptSection}`
      : '';

    const skeletonFragment = skeletonSection
      ? `---\n报告骨架参考（用户自定义）:\n${skeletonSection}`
      : '';

    return { promptFragment, skeletonFragment };
  } catch {
    // 模板读取失败 — 回退默认
    return null;
  }
}
