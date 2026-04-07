import path from "node:path";

export function parseArgs(argv) {
  const args = argv.slice(2).filter(Boolean);
  const [cmd, subcmd, ...rest] = args;
  const flags = {};
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

export function formatDateYmd(d) {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatRangeLabel({ start, end }) {
  return `${formatDateYmd(start)} ~ ${formatDateYmd(end)}`;
}

export function maskSecret(value) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  if (v.length <= 8) return "*".repeat(v.length);
  return `${v.slice(0, 3)}***${v.slice(-3)}`;
}

export function sanitizeFileName(raw) {
  const input = String(raw ?? "").trim() || "report";
  const cleaned = input.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 120) || "report";
}

export function resolveOutputPath({ outputDir, fileName }) {
  const dir = String(outputDir ?? "").trim();
  if (!dir) return path.resolve(process.cwd(), fileName);
  return path.resolve(dir, fileName);
}

