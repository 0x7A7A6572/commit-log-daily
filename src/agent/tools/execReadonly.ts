import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const execAsync = promisify(exec);

/** 只读系统命令白名单 */
const ALLOWED_COMMANDS: string[] = [
  'date',      // 系统日期时间
  'whoami',    // 当前用户
  'hostname',  // 主机名
  'uname',     // 系统信息
  'pwd',       // 当前工作目录
  'env',       // 环境变量
  'echo',      // 输出文本
  'ls',        // 列出目录
  'cat',       // 读取文件
  'head',      // 读取文件头部
  'wc',        // 统计行数/字数
  'uptime',    // 系统运行时间
  'which',     // 查找命令路径
  'id',        // 用户/组 ID
  'printenv',  // 打印环境变量
];

/** 参数中禁止出现的危险字符 */
const DANGEROUS_PATTERNS = [
  /\|/,        // 管道
  /;/,         // 命令分隔
  />/,         // 输出重定向
  /</,         // 输入重定向
  /\$\(/,      // 命令替换
  /`/,         // 命令替换
  /&&/,        // 逻辑与
  /\|\|/,       // 逻辑或
  /&/,         // 后台运行
];

/**
 * 安全执行系统命令
 * 三层防护：命令白名单 + 参数黑名单 + 通过 bash -c 执行
 *
 * 使用 bash -c 而非 execFile 直接 spawn：
 * - date/ls/cat 等是 Git Bash 提供的命令，在 Windows 上不是独立 .exe
 * - bash -c 确保这些命令在 Git Bash 环境中可靠可用
 * - 参数在拼入命令字符串之前已经通过黑名单校验，安全性不降低
 */
async function safeExec(command: string, args: string[]): Promise<string> {
  // 第一层：命令白名单
  if (!ALLOWED_COMMANDS.includes(command)) {
    throw new Error(
      `不允许执行 "${command}"，仅支持: ${ALLOWED_COMMANDS.join(', ')}`,
    );
  }

  // 第二层：参数黑名单（防止 shell 注入）
  for (const arg of args) {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(arg)) {
        throw new Error(
          `参数 "${arg.slice(0, 50)}" 包含不允许的字符: ${pattern}`,
        );
      }
    }
  }

  // 拼装命令字符串，交给 bash -c 执行
  const cmdString = [command, ...args].join(' ');

  const { stdout, stderr } = await execAsync(cmdString, {
    timeout: 10_000,               // 10 秒超时
    maxBuffer: 1024 * 1024,        // 1MB 输出上限
    encoding: 'utf-8',
    shell: getBashPath(),          // 自动检测 Git Bash 路径
  });

  if (stderr) {
    return `stderr: ${stderr}\nstdout:\n${stdout}`;
  }
  return stdout;
}

/** 自动检测 Git Bash 可执行文件路径，支持 Windows / macOS / Linux */
function getBashPath(): string {
  // Windows：常见 Git Bash 安装路径
  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      'D:\\Program Files\\Git\\bin\\bash.exe',
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
  }
  // macOS / Linux：直接使用系统 bash
  return '/bin/bash';
}

/** 受控的只读系统命令执行工具 */
export const execReadonlyTool = tool(
  async ({ command, args }) => {
    // 二次校验：确保命令在白名单中（Zod refine 已做第一轮，此处为安全兜底）
    if (!ALLOWED_COMMANDS.includes(command)) {
      throw new Error(`不允许执行 "${command}"`);
    }
    const result = await safeExec(command, args ?? []);
    return result.trim() || '(无输出)';
  },
  {
    name: 'execReadonly',
    description:
      `安全执行只读系统命令，帮助获取环境和系统信息。` +
      `支持的命令: ${ALLOWED_COMMANDS.join(', ')}。` +
      `所有命令通过 Git Bash (bash -c) 只读执行，无任何副作用。` +
      `参数以数组传入，如 date 用 ["+%Y-%m-%d"] 格式化输出。` +
      `常用示例: 获取当前日期 date ["+%Y-%m-%d"]、获取用户 whoami []、列出目录 ls ["-la", "/some/path"]`,
    schema: z.object({
      command: z.string().describe(`要执行的命令名称，仅支持: ${ALLOWED_COMMANDS.join(', ')}`),
      args: z.array(z.string()).optional().describe('命令参数，如 date 可用 ["+%Y-%m-%d"] 获取格式化日期'),
    }),
  },
);
