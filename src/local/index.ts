import chalk from "chalk";

import en from "./en.js";
import zh from "./zh.js";

type Vars = Record<string, unknown>;

function interpolate(template: unknown, vars?: Vars): string {
  const s = String(template ?? "");
  const map = vars && typeof vars === "object" ? vars : {};
  return s.replace(/\{([a-zA-Z0-9_]+)\}/g, (_: string, k: string) => String(map[k] ?? `{${k}}`));
}

export function bi(enText: unknown, zhText: unknown): string {
  const e = String(enText ?? "").trim();
  const z = String(zhText ?? "").trim();
  if (!e && !z) return "";
  if (!z) return e;
  if (!e) return chalk.hex("#181818")(`  ${z}`);
  return `${e} ${chalk.hex("#181818")(`.....${z}`)}`;
}

export function b(key: unknown, vars?: Vars): string {
  const k = String(key ?? "").trim();
  const enText = Object.prototype.hasOwnProperty.call(en, k) ? en[k] : k;
  const zhText = Object.prototype.hasOwnProperty.call(zh, k) ? zh[k] : k;
  console.log({ enText, zhText });
  return bi(interpolate(enText, vars), interpolate(zhText, vars));
}

export function bet(key: unknown): { name?: string; description?: string } {
  const k = String(key ?? "").trim();
  if (!k) return {};
  const use = buse(k);
  if (!use) return {};
  return {
    name: use.en,
    description: use.zh,
  };
}

export function buse(key: unknown): { en: string; zh: string } {
  const k = String(key ?? "").trim();
  const enText = Object.prototype.hasOwnProperty.call(en, k) ? en[k] : k;
  const zhText = Object.prototype.hasOwnProperty.call(zh, k) ? zh[k] : k;
  return {
    en: interpolate(enText),
    zh: interpolate(zhText),
  };
}

export { en, zh };
