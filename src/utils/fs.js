import fs from "node:fs";
import path from "node:path";

export function readTextFileIfExists(filePath) {
  const p = String(filePath ?? "").trim();
  if (!p) return "";
  try {
    if (!fs.existsSync(p)) return "";
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

export function ensureDirExists(dirPath) {
  const p = String(dirPath ?? "").trim();
  if (!p) return;
  fs.mkdirSync(p, { recursive: true });
}

export function writeTextFile({ filePath, content }) {
  const p = String(filePath ?? "").trim();
  if (!p) throw new Error("filePath 不能为空");
  const dir = path.dirname(p);
  ensureDirExists(dir);
  fs.writeFileSync(p, String(content ?? ""), "utf8");
}

