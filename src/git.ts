import { spawnSync } from "node:child_process";

export type RangePreset = "daily" | "weekly" | "monthly" | "yearly";
export type DateRange = { start: Date; end: Date };

export function getRangeByPreset(preset: RangePreset, now: Date = new Date()): DateRange {
  const end = new Date(now);
  const start = new Date(now);

  const normalizeStartOfDay = (d: Date) => {
    d.setHours(0, 0, 0, 0);
    return d;
  };

  if (preset === "daily") {
    normalizeStartOfDay(start);
    return { start, end };
  }

  if (preset === "weekly") {
    const day = start.getDay();
    const diffFromMonday = (day + 6) % 7;
    start.setDate(start.getDate() - diffFromMonday);
    normalizeStartOfDay(start);
    return { start, end };
  }

  if (preset === "monthly") {
    start.setDate(1);
    normalizeStartOfDay(start);
    return { start, end };
  }

  if (preset === "yearly") {
    start.setMonth(0, 1);
    normalizeStartOfDay(start);
    return { start, end };
  }

  throw new Error(`未知的范围预设: ${preset}`);
}

export function parseDateInput(value: unknown): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const d = new Date(year, month, day);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function toIsoStrict(d: string | number | Date): string {
  return new Date(d).toISOString();
}

export function readGitConfigValue(input: { repoPath: string; key: unknown }): string {
  const k = String(input.key ?? "").trim();
  if (!k) return "";

  const result = spawnSync("git", ["-C", input.repoPath, "config", "--get", k], { encoding: "utf8" });
  if (result.error) return "";
  if (result.status !== 0) return "";
  return String(result.stdout ?? "").trim();
}

export function detectAuthorPattern(repoPath: string): string {
  const email = readGitConfigValue({ repoPath, key: "user.email" });
  if (email) return email;
  const name = readGitConfigValue({ repoPath, key: "user.name" });
  if (name) return name;
  return "";
}

export type GitCommit = { hash: string; author: string; date: string; subject: string };
export type GitBranchInfo = { name: string; date: string; subject: string };

export type GitAuthorIdentity = { name: string; email: string; count: number };

export function readGitLog(input: {
  repoPath: string;
  start: Date;
  end: Date;
  maxCommits?: number;
  authorPattern?: string;
  allRefs?: boolean;
}): GitCommit[] {
  const since = toIsoStrict(input.start);
  const until = toIsoStrict(input.end);

  const args = [
    "-C",
    input.repoPath,
    "log",
    ...(input.allRefs === false ? [] : ["--all"]),
    `--since=${since}`,
    `--until=${until}`,
    ...(String(input.authorPattern ?? "").trim() ? [`--author=${String(input.authorPattern).trim()}`] : []),
    `-n`,
    String(input.maxCommits ?? 500),
    "--pretty=format:%H%x09%an%x09%ad%x09%s",
    "--date=iso-strict",
  ];

  const result = spawnSync("git", args, { encoding: "utf8" });

  if (result.error) {
    throw new Error(`无法执行 git：${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? "").trim();
    const msg = stderr || "git log 执行失败";
    throw new Error(msg);
  }

  const raw = String(result.stdout ?? "").trim();
  if (!raw) return [];

  return raw.split("\n").map((line) => {
    const parts = line.split("\t");
    const hash = parts[0] ?? "";
    const author = parts[1] ?? "";
    const date = parts[2] ?? "";
    const subject = parts.slice(3).join("\t");
    return { hash, author, date, subject };
  });
}

export function listGitAuthorsRecent(input: { repoPath: string; maxCommits?: number }): GitAuthorIdentity[] {
  const args = [
    "-C",
    input.repoPath,
    "log",
    "--all",
    `-n`,
    String(input.maxCommits ?? 300),
    "--pretty=format:%an%x09%ae",
  ];
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.error) return [];
  if (result.status !== 0) return [];

  const raw = String(result.stdout ?? "").trim();
  if (!raw) return [];

  const map = new Map<string, { name: string; email: string; count: number }>();
  for (const line of raw.split("\n")) {
    const parts = line.split("\t");
    const name = String(parts[0] ?? "").trim();
    const email = String(parts[1] ?? "").trim();
    const key = `${name}\t${email}`;
    if (!name && !email) continue;
    const entry = map.get(key) ?? { name, email, count: 0 };
    entry.count += 1;
    map.set(key, entry);
  }

  return Array.from(map.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
}

export function branchesContainingCommit(input: { repoPath: string; hash: string; includeRemotes?: boolean }): string[] {
  const args = ["-C", input.repoPath, "branch", "-a", "--contains", input.hash];
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.error) return [];
  if (result.status !== 0) return [];
  const raw = String(result.stdout ?? "").trim();
  if (!raw) return [];
  const parsed = raw
    .split("\n")
    .map((l) => l.replace(/^\*?\s*/, "").trim())
    .filter(Boolean)
    .map((l) => {
      const arrow = l.indexOf(" -> ");
      if (arrow >= 0) return l.slice(arrow + " -> ".length).trim();
      return l;
    })
    .filter(Boolean);
  const unique = Array.from(new Set(parsed));
  if (input.includeRemotes) return unique;
  return unique.filter((n) => !n.startsWith("remotes/"));
}

export function listGitRemotes(repoPath: string): string[] {
  const result = spawnSync("git", ["-C", repoPath, "remote"], { encoding: "utf8" });
  if (result.error) return [];
  if (result.status !== 0) return [];
  const raw = String(result.stdout ?? "").trim();
  if (!raw) return [];
  return Array.from(new Set(raw.split("\n").map((l) => String(l ?? "").trim()).filter(Boolean)));
}

export function readGitLogRecent(input: { repoPath: string; maxCommits?: number; authorPattern?: string }): GitCommit[] {
  const args = [
    "-C",
    input.repoPath,
    "log",
    "--all",
    ...(String(input.authorPattern ?? "").trim() ? [`--author=${String(input.authorPattern).trim()}`] : []),
    `-n`,
    String(input.maxCommits ?? 80),
    "--pretty=format:%H%x09%an%x09%ad%x09%s",
    "--date=iso-strict",
  ];

  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.error) return [];
  if (result.status !== 0) return [];

  const raw = String(result.stdout ?? "").trim();
  if (!raw) return [];
  return raw.split("\n").map((line) => {
    let parts = line.split("\t");
    if (parts.length < 4 && line.includes("%x09")) parts = line.split("%x09");
    const hash = String(parts[0] ?? "").trim();
    const author = String(parts[1] ?? "").trim();
    const date = String(parts[2] ?? "").trim();
    const subject = String(parts.slice(3).join("\t") ?? "").trim();
    return { hash, author, date, subject };
  });
}

export function listRecentBranches(input: { repoPath: string; limit?: number; includeRemotes?: boolean }): GitBranchInfo[] {
  const limit = Number.isFinite(Number(input.limit)) && Number(input.limit) > 0 ? Math.floor(Number(input.limit)) : 20;
  const includeRemotes = Boolean(input.includeRemotes);
  const refs = includeRemotes ? ["refs/heads", "refs/remotes"] : ["refs/heads"];

  const args = [
    "-C",
    input.repoPath,
    "for-each-ref",
    `--count=${limit}`,
    "--sort=-committerdate",
    "--format=%(refname:short)%x09%(committerdate:iso-strict)%x09%(subject)",
    ...refs,
  ];

  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.error) return [];
  if (result.status !== 0) return [];

  const raw = String(result.stdout ?? "").trim();
  if (!raw) return [];
  return raw.split("\n").map((line) => {
    let parts = line.split("\t");
    if (parts.length < 3 && line.includes("%x09")) parts = line.split("%x09");
    const name = String(parts[0] ?? "").trim();
    const date = String(parts[1] ?? "").trim();
    const subject = String(parts.slice(2).join("\t") ?? "").trim();
    return { name, date, subject };
  });
}
