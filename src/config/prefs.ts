import fs from 'node:fs';
import path from 'node:path';
import { userPreferencesSchema, DEFAULT_PREFERENCES } from './schema.js';
import type { UserPreferences } from './schema.js';
import { CONFIG_DIR } from './store.js';

/** 偏好文件路径 */
const PREFS_PATH = path.join(CONFIG_DIR, 'prefs.json');

/**
 * 读取偏好文件
 * 不存在或解析失败时返回默认值
 */
export function readPreferences(): UserPreferences {
  if (!fs.existsSync(PREFS_PATH)) {
    return structuredClone(DEFAULT_PREFERENCES);
  }
  try {
    const raw = fs.readFileSync(PREFS_PATH, 'utf-8');
    return userPreferencesSchema.parse(JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULT_PREFERENCES);
  }
}

/**
 * 写入偏好文件
 */
export function writePreferences(prefs: UserPreferences): void {
  const validated = userPreferencesSchema.parse(prefs);
  const dir = path.dirname(PREFS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(PREFS_PATH, JSON.stringify(validated, null, 2), 'utf-8');
}

/** 记录任务偏好参数 */
export interface TaskPreferenceParams {
  projects: string[];
  timeRangeType: 'daily' | 'weekly' | 'monthly' | 'custom';
  timeRangeDays: number;
  hasExtraWork: boolean;
}

/**
 * 记录一次任务偏好快照
 * 按 (projects, timeRangeType, timeRangeDays, hasExtraWork) 四元组精确匹配
 * 完全命中 → count++，否则新增一条
 */
export function recordTaskPreference(params: TaskPreferenceParams): void {
  const pref = readPreferences();
  const today = new Date().toISOString().slice(0, 10);
  const sortedProjects = [...params.projects].sort();

  const existing = pref.tasks.find(
    (t) =>
      t.projects.length === sortedProjects.length &&
      t.projects.every((p, i) => p === sortedProjects[i]) &&
      t.timeRangeType === params.timeRangeType &&
      t.timeRangeDays === params.timeRangeDays &&
      t.hasExtraWork === params.hasExtraWork,
  );

  if (existing) {
    existing.count++;
    existing.lastUsed = today;
  } else {
    pref.tasks.push({
      projects: sortedProjects,
      timeRangeType: params.timeRangeType,
      timeRangeDays: params.timeRangeDays,
      hasExtraWork: params.hasExtraWork,
      count: 1,
      lastUsed: today,
    });

    // 上限 20 条：超出时淘汰 count 最低 + 最早使用的条目
    if (pref.tasks.length > 20) {
      pref.tasks.sort((a, b) => a.count - b.count || a.lastUsed.localeCompare(b.lastUsed));
      pref.tasks = pref.tasks.slice(pref.tasks.length - 20);
    }
  }

  try {
    writePreferences(pref);
  } catch {
    // 写入失败不影响主流程
  }
}
