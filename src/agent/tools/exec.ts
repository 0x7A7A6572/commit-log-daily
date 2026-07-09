import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { readConfig } from '../../config/store.js';
import { SafetyLevel } from '../types.js';
import { evaluateSafety, safetyChannelCheck } from '../safety-llm.js';
import { interrupt } from '@langchain/langgraph';



/** 硬性阻止列表 — 始终生效，与 safeMode 无关，防止绕过安全机制 */
const HARD_BLOCKED_COMMANDS: string[] = [
  'powershell', 'pwsh', 'cmd',     // Windows 命令解释器
  'wsl',                            // WSL 桥接
  // 'python', 'python3', 'node',     // 脚本运行时（防止绕过）
];

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

  // 硬性阻止：命令解释器和脚本运行时始终禁止，与 safeMode 无关
  const normalizedCmd = command.toLowerCase();
  if (HARD_BLOCKED_COMMANDS.includes(normalizedCmd)) {
    throw new Error(
      `禁止执行 "${command}"，此命令已被硬性阻止。仅支持通过 Git Bash 执行系统命令。`,
    );
  }

  // 安全模式开启时校验命令白名单
  if (config.safety.safeMode) {
    if (!ALLOWED_COMMANDS.includes(command)) {
      throw new Error(
        `不允许执行 "${command}"，仅支持: ${ALLOWED_COMMANDS.join(', ')}`,
      );
    }
  }

  // 命令安全检查
  await safetyChannelCheck(command, args, {
    [SafetyLevel.Blocked]: () => { throw new Error(`命令 "${command}" 不安全，拒绝执行。`) },
    [SafetyLevel.Warn]: async () => {
      console.warn(`命令 "${command}" 可能不安全，请谨慎使用。`);
      // 通知前端视图弹出用户确认
      const approval = interrupt({
        action: "request_approval",
        command: command,
        args: args,
        safetyLevel: SafetyLevel.Warn,
        message: `安全等级: ${SafetyLevel[SafetyLevel.Warn]}\n即将执行破坏性命令: ${command}，是否继续？`,
      });
      // 💡 恢复执行时，interrupt() 会返回用户的决策
      // 如果用户拒绝，直接返回提示，不执行命令
      if (approval?.decision === "reject") {
        throw new Error(`用户已拒绝执行该危险命令。`);
      }
    },
    [SafetyLevel.Safe]: async () => {},
  });

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


/** 系统命令执行工具 */
export const execTool = tool(
  async ({ command, args }) => {
    const result = await safeExec(command, args ?? []);
    return result.trim() || '(无输出)';
  },
  {
    name: 'execTool',
    description:
      `
# 工具能力
所有命令通过 Git Bash (bash -c) 执行。
参数以数组传入，如 date ["+%Y-%m-%d"] , whoami [] , ls ["-la", "/some/path"]。

# 重要约束
安全模式下:
 - 安全执行只读系统命令，帮助获取环境和系统信息以及文件等。
 - 支持的命令: ${ALLOWED_COMMANDS.join(', ')}。
非安全模式下:
 - 可执行任意命令, 但是在执行破坏性命令时必须用户确认。`,
    schema: z.object({
      command: z.string().describe(`要执行的命令名称`),
      args: z.array(z.string()).optional().describe('命令参数，Array类型'),
    })
  },
);
