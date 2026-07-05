import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
 * 读取配置文件
 * 三层 fallback：默认值 → config.json → 环境变量
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

/** 导出配置目录路径，供 exportFile 工具使用 */
export { CONFIG_DIR };
