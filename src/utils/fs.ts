import fs from "node:fs";
import path from "node:path";

export function readTextFileIfExists(filePath: unknown): string {
  const p = String(filePath ?? "").trim();
  if (!p) return "";
  try {
    if (!fs.existsSync(p)) return "";
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

export function ensureDirExists(dirPath: unknown): void {
  const p = String(dirPath ?? "").trim();
  if (!p) return;
  fs.mkdirSync(p, { recursive: true });
}

export function writeTextFile(input: { filePath: unknown; content: unknown }): void {
  const p = String(input.filePath ?? "").trim();
  if (!p) throw new Error("filePath 不能为空");
  const dir = path.dirname(p);
  ensureDirExists(dir);
  fs.writeFileSync(p, String(input.content ?? ""), "utf8");
}
