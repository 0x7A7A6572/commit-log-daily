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

/** readConfig 内存缓存：仅存储纯净磁盘配置（不含 env override 和 git-user fallback），writeConfig 时同步更新 */
let _configCache: AppConfig | null = null;

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

/** 应用环境变量覆盖（每次 readConfig 均执行，确保运行时 env 变化即时生效） */
function applyEnvOverrides(config: AppConfig): void {
  for (const { envKey, configPath } of ENV_OVERRIDES) {
    const envValue = process.env[envKey];
    if (envValue) {
      setByPath(config, configPath, envValue);
    }
  }
}

/** 仅内存中应用 git-user fallback，不修改缓存和磁盘（配置文件存在但 author 为空时） */
function applyGitUserFallback(config: AppConfig): void {
  if (!config.author.name || !config.author.email) {
    const gitUser = getGitUserConfig();
    if (!config.author.name && gitUser.name) {
      config.author.name = gitUser.name;
    }
    if (!config.author.email && gitUser.email) {
      config.author.email = gitUser.email;
    }
  }
}

/**
 * 读取配置文件
 * 三层 fallback：默认值 → config.json → 环境变量
 * 首次运行时自动从 git config 检测 author 并持久化
 */
export function readConfig(): AppConfig {
  // 缓存命中：从纯净磁盘配置克隆，重新应用运行时覆盖
  if (_configCache) {
    const config = structuredClone(_configCache);
    applyEnvOverrides(config);
    // 配置文件存在但 author 为空时，仅内存中应用 git fallback
    if (fs.existsSync(CONFIG_PATH)) {
      applyGitUserFallback(config);
    }
    return config;
  }

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

  // 缓存纯净磁盘配置（不含 env override 和 git-user fallback）
  _configCache = structuredClone(config);

  // 环境变量覆盖（最高优先级，每次调用均生效）
  applyEnvOverrides(config);

  // 首次运行（无配置文件）时自动检测 git user 并持久化
  if (!fs.existsSync(CONFIG_PATH)) {
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
  } else {
    // 配置文件已存在但 author 为空时，仅内存中使用 git config fallback
    applyGitUserFallback(config);
  }

  return config;
}

/**
 * 写入配置文件
 * 同步更新内存缓存为纯净磁盘版本（不包含 env override 和 git-user fallback）
 */
export function writeConfig(config: AppConfig): void {
  ensureConfigDir();
  const validated = appConfigSchema.parse(config);
  const json = JSON.stringify(validated, null, 2);
  fs.writeFileSync(CONFIG_PATH, json, 'utf-8');
  // 缓存不含运行时覆盖的纯净版本
  _configCache = structuredClone(validated);
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
