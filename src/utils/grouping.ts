import { branchesContainingCommit } from "../git.js";
import { displayRequirementKey, inferRequirementKeyFromSubject, normalizeRequirementKey, pickRequirementKeyFromBranches } from "./requirement.js";

export type GroupingSource = "subject" | "branches";

export type GroupingExtractor =
  | { kind: "regex"; source: GroupingSource; pattern: string; flags?: string; group?: number; keyPrefix?: string }
  | { kind: "builtin"; id: "legacyRequirement" };

export type GroupingRule = {
  id: string;
  name: string;
  enabled: boolean;
  displayStyle: "plain" | "requirementKey";
  extractors: GroupingExtractor[];
  unknownKey: string;
};

function safeRegExp(pattern: string, flags: string): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

export function ruleNeedsBranches(rule: GroupingRule): boolean {
  return rule.extractors.some((e) => e.kind === "builtin" || (e.kind === "regex" && e.source === "branches"));
}

function normalizeKey(key: unknown, unknownKey: string): string {
  const s = String(key ?? "").trim();
  return s || unknownKey;
}

function toDisplayKey(rule: GroupingRule, key: string): string {
  if (rule.displayStyle === "requirementKey") return displayRequirementKey(key);
  return key;
}

function inferLegacyRequirementKey(input: { subject: unknown; branches: unknown[] | null | undefined }): string {
  let key = inferRequirementKeyFromSubject(input.subject);
  if (key === "unknown") {
    const picked = pickRequirementKeyFromBranches(Array.isArray(input.branches) ? input.branches : []);
    if (picked !== "unknown") key = picked;
  }
  return normalizeRequirementKey(key);
}

function inferKeyByRule(input: { subject: string; branches: string[]; rule: GroupingRule }): string {
  const unknownKey = String(input.rule.unknownKey ?? "unknown").trim() || "unknown";
  for (const ex of input.rule.extractors) {
    if (ex.kind === "builtin") {
      if (ex.id === "legacyRequirement") {
        const key = inferLegacyRequirementKey({ subject: input.subject, branches: input.branches });
        if (key && key !== "unknown") return normalizeKey(key, unknownKey);
      }
      continue;
    }

    const re = safeRegExp(String(ex.pattern ?? ""), String(ex.flags ?? ""));
    if (!re) continue;
    const groupIndex = Number.isFinite(Number(ex.group)) ? Math.max(0, Math.floor(Number(ex.group))) : 1;
    const prefix = String(ex.keyPrefix ?? "").trim();

    if (ex.source === "subject") {
      const m = input.subject.match(re);
      if (!m) continue;
      const captured = m[groupIndex] ?? m[0] ?? "";
      const key = prefix ? `${prefix}${captured}` : String(captured ?? "");
      return normalizeKey(key, unknownKey);
    }

    for (const b of input.branches) {
      const m = String(b ?? "").match(re);
      if (!m) continue;
      const captured = m[groupIndex] ?? m[0] ?? "";
      const key = prefix ? `${prefix}${captured}` : String(captured ?? "");
      return normalizeKey(key, unknownKey);
    }
  }
  return unknownKey;
}

export function groupCommitsByRule(
  commits: Array<{ subject: string; author: string; date: string; hash: string }>,
  input: { rule: GroupingRule; repoPath?: string; branchesContainsEnabled?: boolean },
): Array<{
  key: string;
  displayKey: string;
  total: number;
  items: Array<{ subject: string; author: string; date: string; hash: string }>;
}> {
  const rule = input.rule;
  const unknownKey = String(rule.unknownKey ?? "unknown").trim() || "unknown";
  const map = new Map<string, { total: number; items: Array<{ subject: string; author: string; date: string; hash: string }> }>();
  const needBranches = Boolean(input.branchesContainsEnabled) && ruleNeedsBranches(rule);
  const branchCache = new Map<string, string[]>();

  for (const c of commits) {
    const subject = String(c.subject ?? "");
    const hash = String(c.hash ?? "").trim();
    const branches = (() => {
      if (!needBranches) return [];
      if (!hash || !input.repoPath) return [];
      const cached = branchCache.get(hash);
      if (cached) return cached;
      const list = branchesContainingCommit({ repoPath: input.repoPath, hash, includeRemotes: true })
        .map((b) => String(b ?? "").trim())
        .filter(Boolean);
      branchCache.set(hash, list);
      return list;
    })();

    const key = normalizeKey(inferKeyByRule({ subject, branches, rule }), unknownKey);
    const entry = map.get(key) ?? { total: 0, items: [] };
    entry.total += 1;
    entry.items.push({
      subject,
      author: String(c.author ?? ""),
      date: String(c.date ?? ""),
      hash: String(c.hash ?? ""),
    });
    map.set(key, entry);
  }

  return Array.from(map.entries())
    .map(([key, v]) => ({ key, displayKey: toDisplayKey(rule, key), total: v.total, items: v.items }))
    .sort((a, b) => b.total - a.total || a.displayKey.localeCompare(b.displayKey));
}
