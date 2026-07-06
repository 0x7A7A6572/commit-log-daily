import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { appConfigSchema, DEFAULT_CONFIG, ENV_OVERRIDES } from './schema.js';
import type { AppConfig } from './schema.js';

/** 配置文件目录 */
const CONFIG_DIR = path.join(os.homedir(), '.commit-log-daily');

/** 配置文件路径 */
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

/** 确保配置目录存在 */
function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * 从全局 git config 获取用户名和邮箱
 * 作为 author 配置的自动检测 fallback
 */
function getGitUserConfig(): { name: string; email: string } {
  const result = { name: '', email: '' };
  try {
    result.name = execSync('git config --global user.name', { encoding: 'utf-8' }).trim();
  } catch {
    // git 未安装或 user.name 未配置，静默跳过
  }
  try {
    result.email = execSync('git config --global user.email', { encoding: 'utf-8' }).trim();
  } catch {
    // git 未安装或 user.email 未配置，静默跳过
  }
  return result;
}

/**
 * 读取配置文件
 * 三层 fallback：默认值 → config.json → 环境变量
 * author 字段为空时自动从 git config 检测并持久化
 */
export function readConfig(): AppConfig {
  ensureConfigDir();

  // 从默认值开始
  let config = structuredClone(DEFAULT_CONFIG);

  // 尝试读取配置文件
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const fileData = JSON.parse(raw) as unknown;
      // Zod 校验并合并
      const validated = appConfigSchema.parse(fileData);
      config = validated;
    } catch {
      // 配置文件损坏时回退到默认值，不抛异常
      // 后续 writeConfig 会覆盖损坏文件
    }
  }

  // 环境变量覆盖（最高优先级）
  for (const { envKey, configPath } of ENV_OVERRIDES) {
    const envValue = process.env[envKey];
    if (envValue) {
      setByPath(config, configPath, envValue);
    }
  }

  // 如果 author 字段为空，自动从 git config 检测并持久化
  if (!config.author.name || !config.author.email) {
    const gitUser = getGitUserConfig();
    let changed = false;
    if (!config.author.name && gitUser.name) {
      config.author.name = gitUser.name;
      changed = true;
    }
    if (!config.author.email && gitUser.email) {
      config.author.email = gitUser.email;
      changed = true;
    }
    if (changed) {
      try {
        writeConfig(config);
      } catch {
        // 写入失败不影响读取结果
      }
    }
  }

  return config;
}

/**
 * 写入配置文件
 */
export function writeConfig(config: AppConfig): void {
  ensureConfigDir();
  const validated = appConfigSchema.parse(config);
  const json = JSON.stringify(validated, null, 2);
  fs.writeFileSync(CONFIG_PATH, json, 'utf-8');
}

/**
 * 按路径字符串设置嵌套对象的值
 * 例如 setByPath(config, 'model.apiKey', 'sk-xxx')
 */
function setByPath(obj: Record<string, unknown>, pathStr: string, value: string): void {
  const keys = pathStr.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    if (!(key in current) || typeof current[key] !== 'object') {
      return;
    }
    current = current[key] as Record<string, unknown>;
  }
  const lastKey = keys[keys.length - 1]!;
  current[lastKey] = value;
}

/** 导出配置目录路径，供 writeFile 工具使用 */
export { CONFIG_DIR };
