export function normalizeRequirementKey(raw: unknown): string {
  const k = String(raw ?? "").trim();
  if (!k) return "unknown";
  if (k === "unknown") return "unknown";
  if (k.startsWith("zentao:")) {
    const tail = k.slice("zentao:".length).trim();
    return `zentao:${tail || "unknown"}`;
  }
  if (/^[a-zA-Z]{1,3}\d{2,}$/.test(k)) return k.toUpperCase();
  if (/^release\//i.test(k)) return `release/${k.slice("release/".length)}`;
  return k;
}

export function isStrongRequirementKey(key: unknown): boolean {
  return /^[A-Z]{1,3}\d{2,}$/.test(normalizeRequirementKey(key));
}

export function inferRequirementKeyFromBranchToken(input: { branchType: unknown; tail: unknown }): string {
  const branchType = String(input.branchType ?? "").trim().toLowerCase();
  const tailRaw = String(input.tail ?? "").trim();
  if (!tailRaw) return "unknown";
  if (branchType === "release") return normalizeRequirementKey(`release/${tailRaw}`);

  const tail = tailRaw.replace(/^['"]|['"]$/g, "");
  const normalized = tail.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
  const parts = normalized.split(/[_\-\.]+/).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^[a-zA-Z]{1,3}\d{2,}$/);
    if (m) return normalizeRequirementKey(String(m[0]));
  }
  for (const part of parts) {
    const n = part.match(/^\d{2,}$/);
    if (n) return normalizeRequirementKey(`zentao:${String(n[0])}`);
  }

  const withoutLeading = normalized.replace(/^[a-zA-Z]+[_-]?/, "");
  const key = (withoutLeading || normalized).trim();
  return normalizeRequirementKey(key || "unknown");
}

export function inferRequirementKeyFromSubject(subject: unknown): string {
  const s = String(subject ?? "").trim();
  if (!s) return "unknown";

  const matches = Array.from(s.matchAll(/\b(feature|feat|hotfix|bugfix|release)\/([^\s'"]+)/gi));
  if (matches.length) {
    const last = matches[matches.length - 1];
    return normalizeRequirementKey(inferRequirementKeyFromBranchToken({ branchType: last[1] ?? "", tail: last[2] ?? "" }));
  }

  const code = s.match(/\b([a-zA-Z]{1,3}\d{2,})\b/);
  if (code) return normalizeRequirementKey(String(code[1] ?? "").trim());

  const zt = s.match(/\b(?:zentao|禅道)\s*#?\s*(\d{2,})\b/i);
  if (zt) return normalizeRequirementKey(`zentao:${String(zt[1] ?? "").trim()}`);

  const plainId = s.match(/\b(\d{5,})\b/);
  if (plainId) return normalizeRequirementKey(`zentao:${String(plainId[1] ?? "").trim()}`);

  return "unknown";
}

export function displayRequirementKey(key: unknown): string {
  const k = normalizeRequirementKey(key);
  if (!k) return "unknown";
  if (k.startsWith("zentao:")) return k.slice("zentao:".length) || k;
  return k;
}

export function canonicalizeBranchName(raw: unknown): string {
  let n = String(raw ?? "").trim();
  if (!n) return "";
  n = n.replace(/^\*\s+/, "");
  n = n.replace(/^remotes\//, "");
  if (/^[^/]+\/(feature|feat|hotfix|bugfix|release)\/.+/i.test(n)) n = n.replace(/^[^/]+\//, "");
  return n;
}

export function extractRequirementKeyFromBranchName(name: unknown): string {
  const n = canonicalizeBranchName(name);
  const m = n.match(/\b(feature|feat|hotfix|bugfix|release)\/(.+)$/i);
  if (m) return normalizeRequirementKey(inferRequirementKeyFromBranchToken({ branchType: m[1] ?? "", tail: m[2] ?? "" }));
  return "unknown";
}

export function pickRequirementKeyFromBranches(branches: unknown[] | null | undefined): string {
  const list = (Array.isArray(branches) ? branches : []).map((b) => extractRequirementKeyFromBranchName(b)).filter((k) => k !== "unknown");
  if (!list.length) return "unknown";
  const strong = list.find((k) => isStrongRequirementKey(k));
  return normalizeRequirementKey(strong ?? list[0] ?? "unknown");
}

