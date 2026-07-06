import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { readConfig, writeConfig } from '../../config/store.js';

/** 安全模式开关工具 */
export const toggleSafeModeTool = tool(
  async ({ enable }) => {
    const config = readConfig();

    // 如果用户指定了 enable 值且与当前一致，无需操作
    const current = config.safety.safeMode;
    if (enable !== undefined && enable === current) {
      const stateText = current ? '已开启' : '已关闭';
      return `安全模式当前${stateText}，无需更改。`;
    }

    // 确定目标状态
    const target = enable ?? !current;
    config.safety.safeMode = target;
    writeConfig(config);

    if (target) {
      // 开启安全模式 → 恢复限制
      return [
        '✅ 安全模式已开启',
        '',
        '当前限制：',
        '  • Git 命令 — 仅允许白名单中的只读子命令（blame、log、diff、show、status 等 22 个）',
        '  • 系统命令 — 仅允许预定义的安全命令（date、ls、cat 等 15 个），参数禁止管道/重定向',
        '  • 所有命令通过 execFile 数组传参，不经过 Shell',
        '',
        '⚠️ 如需关闭安全模式以执行任意命令，请明确说出"关闭安全模式"。',
        '关闭后所有 git 命令和系统命令将不再受限制，请谨慎操作。',
      ].join('\n');
    }

    // 关闭安全模式 → 解除限制
    return [
      '⚠️⚠️⚠️ 安全模式已关闭 ⚠️⚠️⚠️',
      '',
      '【警告】以下限制已被移除：',
      '  • Git 命令白名单已解除 — 现在可以执行任意 git 子命令（包括 add、commit、push、reset 等写入操作）',
      '  • 系统命令白名单已解除 — 现在可以执行任意系统命令',
      '  • 参数黑名单已解除 — 管道、重定向、命令替换均可使用',
      '',
      '【风险】此模式下 Agent 可以：',
      '  • 修改/提交/推送代码到 Git 仓库',
      '  • 执行任意系统级命令',
      '  • 删除或修改文件',
      '',
      '【建议】完成需要的操作后，请立即说"开启安全模式"恢复限制。',
      '',
      '当前安全模式状态: ❌ 已关闭（无限制模式）',
    ].join('\n');
  },
  {
    name: 'toggleSafeMode',
    description:
      '切换安全模式。安全模式开启时 Git 和系统命令受白名单限制（仅允许只读操作）。' +
      '关闭后允许执行任意命令。此工具仅应在用户明确要求时调用，绝对不可自动调用。',
    schema: z.object({
      enable: z.boolean().optional().describe(
        'true = 开启安全模式，false = 关闭安全模式。不传则切换当前状态。',
      ),
    }),
  },
);
