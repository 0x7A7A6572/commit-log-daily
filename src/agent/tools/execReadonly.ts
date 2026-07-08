import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { readConfig } from '../../config/store.js';

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

/**
 * 安全执行系统命令
 * 使用 spawn + bash -c "$@" 保持参数边界：
 * - 参数以数组原样传给 bash，不经过 shell 字符串拼接 + 二次解析
 * - 含空格、$、* 等特殊字符的参数不会被错误拆分或展开
 */
async function safeExec(command: string, args: string[]): Promise<string> {
  const config = readConfig();

  // 安全模式开启时校验命令白名单
  if (config.safety.safeMode) {
    if (!ALLOWED_COMMANDS.includes(command)) {
      throw new Error(
        `不允许执行 "${command}"，仅支持: ${ALLOWED_COMMANDS.join(', ')}`,
      );
    }
  }

  const bashPath = getBashPath();

  return new Promise((resolve, reject) => {
    // bash -c 'command "$@"' command arg1 arg2 ...
    // "$@" 保持每个参数的边界，无论是否含空格/特殊字符
    const child: ChildProcessWithoutNullStreams = spawn(bashPath, ['-c', `${command} "$@"`, command, ...args], {
      timeout: 10_000,       // 10 秒超时
      // encoding: 'utf-8',
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`命令执行失败 (exit ${code}): ${stderr || stdout || '(无输出)'}`));
        return;
      }
      // 部分命令将结果写入 stderr（如某些平台上 date --help 有时输出到 stderr）
      if (stderr && !stdout) {
        resolve(stderr);
      } else {
        resolve(stdout);
      }
    });

    child.on('error', (err) => {
      reject(new Error(`无法启动命令 "${command}": ${err.message}`));
    });
  });
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
    const config = readConfig();
    // 安全模式开启时做二次校验（Zod refine 已做第一轮，此处为安全兜底）
    if (config.safety.safeMode && !ALLOWED_COMMANDS.includes(command)) {
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
