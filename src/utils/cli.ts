import path from "node:path";
import stringWidth from "string-width";
import chalk from "chalk";

export type ParsedArgs = {
  cmd: string;
  subcmd: string;
  flags: Record<string, string | boolean>;
  raw: string[];
};

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2).filter(Boolean);
  const [cmd = "", subcmd = "", ...rest] = args;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      i += 1;
    }
  }
  return { cmd, subcmd, flags, raw: args };
}

export function formatDateYmd(d: string | number | Date): string {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatRangeLabel(input: { start: string | number | Date; end: string | number | Date }): string {
  return `${formatDateYmd(input.start)} ~ ${formatDateYmd(input.end)}`;
}

export function maskSecret(value: unknown): string {
  const v = String(value ?? "").trim();
  if (!v) return "";
  if (v.length <= 8) return "*".repeat(v.length);
  return `${v.slice(0, 3)}***${v.slice(-3)}`;
}

export function sanitizeFileName(raw: unknown): string {
  const input = String(raw ?? "").trim() || "report";
  const cleaned = input.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 120) || "report";
}

export function resolveOutputPath(input: { outputDir: unknown; fileName: string }): string {
  const dir = String(input.outputDir ?? "").trim();
  if (!dir) return path.resolve(process.cwd(), input.fileName);
  return path.resolve(dir, input.fileName);
}

export type KeyValueRow = { k: unknown; v: unknown };

export function formatKeyValueTable(rows: KeyValueRow[] | unknown): string {
  const normalized = (Array.isArray(rows) ? rows : []).map((r) => ({
    k: String((r as KeyValueRow | null | undefined)?.k ?? ""),
    v: String((r as KeyValueRow | null | undefined)?.v ?? ""),
  }));
  const keyWidth = Math.max(stringWidth("字段"), ...normalized.map((r) => stringWidth(r.k)));
  const valWidth = Math.max(stringWidth("值"), ...normalized.map((r) => stringWidth(r.v)));
  const line = `+${"-".repeat(keyWidth + 2)}+${"-".repeat(valWidth + 2)}+`;
  const cell = (text: string, width: number) => {
    const t = String(text);
    const w = stringWidth(t);
    const pad = Math.max(0, width - w);
    return ` ${t}${" ".repeat(pad)} `;
  };
  const out: string[] = [];
  out.push(line);
  out.push(`|${cell("字段", keyWidth)}|${cell("值", valWidth)}|`);
  out.push(line);
  for (const r of normalized) out.push(`|${cell(r.k, keyWidth)}|${cell(r.v, valWidth)}|`);
  out.push(line);
  return out.join("\n");
}

export type CliChoice<T = unknown> = { name: string; value: T; description?: string };

export function formatCliChoiceName(input: { title: unknown; stats?: unknown; status?: unknown }): string {
  const title = String(input.title ?? "").trim();
  const statsRaw = String(input.stats ?? "").trim();
  const statusRaw = String(input.status ?? "").trim();
  const parts: string[] = [];
  if (title) parts.push(title);
  if (statsRaw) parts.push(chalk.gray(`(${statsRaw})`));
  if (statusRaw) parts.push(chalk.yellow(`[${statusRaw}]`));
  return parts.join(" ").trim();
}

export function makeCliChoice<T>(input: { title: unknown; value: T; stats?: unknown; status?: unknown; description?: unknown }): CliChoice<T> {
  const name = formatCliChoiceName({ title: input.title, stats: input.stats, status: input.status });
  const description = String(input.description ?? "").trim();
  if (description) return { name, value: input.value, description };
  return { name, value: input.value };
}

export function makeBackChoice<T>(input: { value: T; title?: unknown }): CliChoice<T> {
  const title = String(input.title ?? "返回").trim() || "返回";
  return { name: chalk.gray(title), value: input.value };
}
