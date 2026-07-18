/**
 * 将 token 计数转为单位字符
 */
export function tokenCountToUnit(count: number): string {
  if (count < 1000) {
    return `${count}`;
  } else if (count < 1000000) {
    return `${(count / 1000).toFixed(1)}K`;
  } else if (count < 1000000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  } else {
    return `${(count / 1000000000).toFixed(1)}B`;
  }
}

import { randomBytes } from 'node:crypto';

/**
 * 生成符合 RFC 4122 v4 规范的 UUID
 * 使用 node:crypto 的 randomBytes，兼容 Node.js 14.17+
 */
export function generateUUID(): string {
  const bytes = randomBytes(16);
  // 设置 version 4
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  // 设置 variant 1
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * 规范化 baseUrl：确保以 /v1 结尾（兼容用户漏写 /v1 的情况）
 */
export function normalizeBaseUrl(raw: string): string {
  let url = raw.trim();
  if (url && !url.endsWith('/v1') && !url.endsWith('/v1/')) {
    url = url.replace(/\/$/, '') + '/v1';
  }
  return url;
}