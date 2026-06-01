import path from "node:path";
import process from "node:process";

import { loadConfig, updateFeaturesConfig, updateProjectsScanConfig, updateReportConfig } from "../config.js";
import { formatKeyValueTable, makeBackChoice, makeCliChoice } from "../utils/cli.js";
import { readGitLogRecent } from "../git.js";
import { groupCommitsByRule, ruleNeedsBranches } from "../utils/grouping.js";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v && typeof v === "object" && !Array.isArray(v));
}

function formatOutputMode(mode: unknown): string {
  const m = String(mode ?? "").trim();
  if (m === "file") return "仅导出文件";
  if (m === "both") return "终端 + 文件";
  return "仅终端显示";
}

async function pause(inquirer: any, message: string = "按回车继续"): Promise<void> {
  await inquirer.prompt([{ type: "input", name: "__pause__", message }]);
}

function formatExtractorLabel(ex: any): string {
  if (!ex || typeof ex !== "object") return "unknown";
  if (ex.kind === "builtin") return `builtin:${String(ex.id ?? "")}`;
  if (ex.kind === "regex") {
    const src = String(ex.source ?? "subject");
    const flags = String(ex.flags ?? "");
    const group = Number.isFinite(Number(ex.group)) ? `#${Math.floor(Number(ex.group))}` : "";
    const prefix = String(ex.keyPrefix ?? "").trim();
    return `regex:${src}:${String(ex.pattern ?? "")}${flags ? `/${flags}` : ""}${group}${prefix ? ` prefix=${prefix}` : ""}`;
  }
  return String(ex.kind ?? "unknown");
}

function normalizeRegexFlags(raw: unknown): string {
  const f = String(raw ?? "").trim();
  if (!f) return "";
  const chars = Array.from(new Set(f.split("").filter(Boolean)));
  const filtered = chars.filter((c) => c !== "g");
  return filtered.join("");
}

function normalizeRuleDraft(draft: any): any {
  const rule = isPlainObject(draft) ? draft : {};
  const id = String(rule.id ?? "").trim();
  const name = String(rule.name ?? "").trim() || id;
  const enabled = rule.enabled !== false;
  const displayStyleRaw = String(rule.displayStyle ?? "plain").trim();
  const displayStyle = displayStyleRaw === "requirementKey" ? "requirementKey" : "plain";
  const unknownKey = String(rule.unknownKey ?? "unknown").trim() || "unknown";
  const extractorsRaw = Array.isArray(rule.extractors) ? rule.extractors : [];
  const extractors = extractorsRaw
    .filter((e) => isPlainObject(e) && (e.kind === "regex" || e.kind === "builtin"))
    .map((e: any) => {
      if (!e || typeof e !== "object") return e;
      if (e.kind !== "regex") return e;
      const source = String(e.source ?? "subject").trim() === "branches" ? "branches" : "subject";
      const pattern = String(e.pattern ?? "").trim();
      const flags = normalizeRegexFlags(e.flags);
      const group = Number.isFinite(Number(e.group)) ? Math.max(0, Math.floor(Number(e.group))) : 1;
      const keyPrefix = String(e.keyPrefix ?? "").trim();
      const next: any = { kind: "regex", source, pattern, group };
      if (flags) next.flags = flags;
      if (keyPrefix) next.keyPrefix = keyPrefix;
      return next;
    });
  return { id, name, enabled, displayStyle, unknownKey, extractors };
}

function validateRule(rule: any): { ok: true } | { ok: false; reason: string } {
  const r = normalizeRuleDraft(rule);
  if (!r.id) return { ok: false, reason: "id 不能为空" };
  if (!r.name) return { ok: false, reason: "name 不能为空" };
  if (!Array.isArray(r.extractors) || !r.extractors.length) return { ok: false, reason: "至少需要一个 extractor" };
  return { ok: true };
}

async function promptRegexExtractor(inquirer: any, current?: any): Promise<any> {
  const cur = isPlainObject(current) ? current : {};
  const src = String(cur.source ?? "subject").trim() === "branches" ? "branches" : "subject";
  const pattern = String(cur.pattern ?? "").trim();
  const flags = normalizeRegexFlags(cur.flags);
  const group = Number.isFinite(Number(cur.group)) ? String(Math.max(0, Math.floor(Number(cur.group)))) : "1";
  const keyPrefix = String(cur.keyPrefix ?? "").trim();

  const answers = await inquirer.prompt([
    {
      type: "list",
      name: "source",
      message: "匹配来源（一般用 subject；只有你想从分支名提取 key 时才用 branches）",
      choices: [
        makeCliChoice({ title: "提交主题 subject", status: "推荐", value: "subject" }),
        makeCliChoice({ title: "分支名 branches", description: "会调用 git 查分支，可能更慢", value: "branches" }),
      ],
      default: src === "branches" ? 1 : 0,
    },
    {
      type: "input",
      name: "pattern",
      message: "正则 pattern（建议写捕获组，比如：\\b([A-Z]+-\\d+)\\b）",
      default: pattern,
      validate: (v: unknown) => {
        const p = String(v ?? "").trim();
        if (!p) return "必填";
        try {
          new RegExp(p);
          return true;
        } catch (e) {
          return `正则无效：${String((e as any)?.message ?? e)}`;
        }
      },
    },
    {
      type: "input",
      name: "flags",
      message: "正则 flags（可选，如 i/m；不支持 g，因为会破坏捕获组）",
      default: flags,
      validate: (v: unknown) => {
        const f = String(v ?? "").trim();
        if (!f) return true;
        if (f.includes("g")) return "请不要使用 g（全局匹配会导致捕获组不可用）。直接去掉 g 即可。";
        try {
          new RegExp("a", f);
          return true;
        } catch (e) {
          return `flags 无效：${String((e as any)?.message ?? e)}`;
        }
      },
    },
    {
      type: "input",
      name: "group",
      message: "取第几个捕获组（默认 1；0=整体匹配；比如 pattern 有 (XXX) 就填 1）",
      default: group,
      validate: (v: unknown) => (Number(String(v ?? "").trim()) >= 0 ? true : "必须是 >= 0 的数字"),
    },
    { type: "input", name: "keyPrefix", message: "key 前缀（可选，比如 zentao:）", default: keyPrefix },
  ]);

  const next: any = {
    kind: "regex",
    source: String(answers.source ?? "subject").trim() === "branches" ? "branches" : "subject",
    pattern: String(answers.pattern ?? "").trim(),
  };
  const f = normalizeRegexFlags(answers.flags);
  if (f) next.flags = f;
  const g = Math.max(0, Math.floor(Number(String(answers.group ?? "1").trim())));
  if (Number.isFinite(g)) next.group = g;
  const pref = String(answers.keyPrefix ?? "").trim();
  if (pref) next.keyPrefix = pref;
  return next;
}

function formatGroupingPreview(groups: Array<{ displayKey: string; key: string; total: number; items: Array<{ subject: string }> }>, unknownKey: string): string {
  const total = groups.reduce((acc, g) => acc + (Number(g.total) || 0), 0);
  const unknown = groups.find((g) => g.key === unknownKey)?.total ?? 0;
  const rows = groups
    .filter((g) => g.key !== unknownKey)
    .slice(0, 12)
    .map((g) => {
      const examples = g.items
        .slice(0, 2)
        .map((it) => String(it.subject ?? "").trim())
        .filter(Boolean)
        .join(" / ");
      return [String(g.displayKey ?? ""), String(g.total ?? 0), examples];
    });
  const table = formatKeyValueTable([
    { k: "总提交数（预览）", v: String(total) },
    { k: `${unknownKey}（未匹配）`, v: String(unknown) },
  ]);
  const list = rows.length ? formatKeyValueTable(rows.map((r) => ({ k: `${r[0]}（${r[1]}）`, v: r[2] || "（无例子）" }))) : "（无匹配结果）";
  return `${table}\n\nTop 分组（最多 12 个，每组最多 2 条示例）：\n${list}`;
}

function makeUniqueRuleId(input: { wanted: string; existing: Set<string> }): string {
  const base = String(input.wanted ?? "").trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  const seed = base || "rule";
  if (!input.existing.has(seed)) return seed;
  for (let i = 2; i < 999; i += 1) {
    const candidate = `${seed}-${i}`;
    if (!input.existing.has(candidate)) return candidate;
  }
  return `${seed}-${Date.now()}`;
}

async function addGroupingRuleWizardInteractive(inquirer: any): Promise<void> {
  const config = loadConfig();
  const groupingCfg = config?.features?.grouping ?? { enabled: true, defaultRuleId: "", rules: [] };
  const branchesContainsEnabled = Boolean((groupingCfg as any)?.branchesContainsEnabled);
  const rules = (Array.isArray(groupingCfg.rules) ? groupingCfg.rules : []).filter(Boolean);
  const existingIds = new Set(rules.map((r: any) => String(r?.id ?? "").trim()).filter(Boolean));

  const templates: Array<{ name: string; value: string; draft: any }> = [
    {
      name: "从提交主题提取 JIRA Key（如 ABC-123）",
      value: "jiraSubject",
      draft: {
        id: "jira-subject",
        name: "按 JIRA Key 分组（subject）",
        enabled: true,
        displayStyle: "plain",
        unknownKey: "unknown",
        extractors: [{ kind: "regex", source: "subject", pattern: "\\\\b([A-Z][A-Z0-9]+-\\\\d+)\\\\b", flags: "", group: 1 }],
      },
    },
    {
      name: "从提交主题提取 禅道/zentao 需求号（如 禅道 12345）",
      value: "zentaoSubject",
      draft: {
        id: "zentao-subject",
        name: "按 禅道需求号 分组（subject）",
        enabled: true,
        displayStyle: "requirementKey",
        unknownKey: "unknown",
        extractors: [{ kind: "regex", source: "subject", pattern: "\\\\b(?:zentao|禅道)\\\\s*#?\\\\s*(\\\\d{2,})\\\\b", flags: "i", group: 1, keyPrefix: "zentao:" }],
      },
    },
    {
      name: "从分支名提取 需求号（如 feature/ABC-123 或 bugfix/ABC-123）",
      value: "branchKey",
      draft: {
        id: "branch-key",
        name: "按 分支需求Key 分组（branches）",
        enabled: true,
        displayStyle: "plain",
        unknownKey: "unknown",
        extractors: [{ kind: "regex", source: "branches", pattern: "\\\\b(feature|feat|bugfix|hotfix|release)\\\\/([^\\\\s\\\\/]+)", flags: "i", group: 2 }],
      },
    },
    {
      name: "从提交主题提取 [tag]（如 [payment] xxx）",
      value: "bracketTag",
      draft: {
        id: "tag-subject",
        name: "按 [tag] 分组（subject）",
        enabled: true,
        displayStyle: "plain",
        unknownKey: "unknown",
        extractors: [{ kind: "regex", source: "subject", pattern: "\\\\[([^\\\\]]+)\\\\]", flags: "", group: 1 }],
      },
    },
    {
      name: "从提交主题提取 Conventional Commit scope（如 feat(ui): ...）",
      value: "ccScope",
      draft: {
        id: "scope-subject",
        name: "按 scope 分组（subject）",
        enabled: true,
        displayStyle: "plain",
        unknownKey: "unknown",
        extractors: [{ kind: "regex", source: "subject", pattern: "^[a-zA-Z][a-zA-Z0-9_-]*\\\\(([^)]+)\\\\)", flags: "", group: 1 }],
      },
    },
    {
      name: "Legacy 内置：按需求/任务分组（分支/提交推断）",
      value: "legacyRequirement",
      draft: {
        id: "legacy-requirement",
        name: "Legacy: 按需求/任务分组（分支/提交推断）",
        enabled: true,
        displayStyle: "requirementKey",
        unknownKey: "unknown",
        extractors: [{ kind: "builtin", id: "legacyRequirement" }],
      },
    },
  ];

  const { pickedTemplate } = await inquirer.prompt([
    {
      type: "list",
      name: "pickedTemplate",
      loop: false,
      message: "快速开始：你想按什么分组？",
      choices: templates
        .map((t) => {
          const raw = String(t.name ?? "").trim();
          const m = raw.match(/^(.+?)（(.+?)）$/);
          if (!m) return makeCliChoice({ title: raw, value: t.value });
          return makeCliChoice({ title: m[1], description: m[2], value: t.value });
        })
        .concat([makeBackChoice({ value: "" })]),
    },
  ]);
  const key = String(pickedTemplate ?? "").trim();
  if (!key) return;
  const tpl = templates.find((t) => t.value === key);
  if (!tpl) return;

  const baseDraft = normalizeRuleDraft(tpl.draft);
  const uniqueId = makeUniqueRuleId({ wanted: baseDraft.id, existing: existingIds });

  const answers = await inquirer.prompt([
    { type: "input", name: "id", message: "规则 id（建议英文短横线；用于引用）", default: uniqueId, validate: (v: unknown) => (String(v).trim() ? true : "必填") },
    { type: "input", name: "name", message: "规则名称（展示用）", default: baseDraft.name, validate: (v: unknown) => (String(v).trim() ? true : "必填") },
    { type: "confirm", name: "enabled", message: "默认启用？", default: true },
    {
      type: "list",
      name: "displayStyle",
      message: "显示样式（只影响展示，不改变分组 key 本身）",
      choices: [
        makeCliChoice({ title: "plain", description: "原样显示", value: "plain" }),
        makeCliChoice({ title: "requirementKey", description: "zentao:123 显示成 123", value: "requirementKey" }),
      ],
      default: baseDraft.displayStyle === "requirementKey" ? 1 : 0,
    },
    { type: "input", name: "unknownKey", message: "未匹配分组 key（建议保留 unknown）", default: baseDraft.unknownKey || "unknown", validate: (v: unknown) => (String(v).trim() ? true : "必填") },
  ]);

  const id = String(answers.id ?? "").trim();
  if (rules.some((r: any) => String(r?.id ?? "").trim() === id)) {
    console.log(`已存在同名 id：${id}`);
    return;
  }

  let draft = {
    ...baseDraft,
    id,
    name: String(answers.name ?? "").trim(),
    enabled: Boolean(answers.enabled),
    displayStyle: String(answers.displayStyle ?? "plain").trim() === "requirementKey" ? "requirementKey" : "plain",
    unknownKey: String(answers.unknownKey ?? "unknown").trim() || "unknown",
  };

  const ex0 = Array.isArray(draft.extractors) ? draft.extractors[0] : null;
  if (ex0 && ex0.kind === "regex") {
    const { tweak } = await inquirer.prompt([{ type: "confirm", name: "tweak", message: "需要调整正则/来源/捕获组吗？", default: false }]);
    if (tweak) {
      const ex = await promptRegexExtractor(inquirer, ex0);
      draft = { ...draft, extractors: [ex] };
    }
  }

  const check = validateRule(draft);
  if (!check.ok) {
    console.log(`规则无效：${check.reason}`);
    return;
  }

  const projects = Array.isArray(config.projects) ? config.projects : [];
  if (projects.length) {
    const { doPreview } = await inquirer.prompt([{ type: "confirm", name: "doPreview", message: "预览一下最近提交的分组效果？", default: true }]);
    if (doPreview) {
      const { pickedProject } = await inquirer.prompt([
        {
          type: "list",
          name: "pickedProject",
          loop: false,
          message: "选择一个项目做预览（读取最近提交）",
          choices: projects
            .map((p: any) => makeCliChoice({ title: String(p?.name ?? ""), stats: String(p?.path ?? ""), value: String(p?.name ?? "") }))
            .concat([{ name: "跳过预览", value: "" }]),
        },
      ]);
      const pn = String(pickedProject ?? "").trim();
      if (pn) {
        const p = projects.find((x: any) => String(x?.name ?? "") === pn);
        const repoPath = String(p?.path ?? "").trim();
        const authorPattern = String(config?.git?.author ?? "").trim();
        const commits = repoPath ? readGitLogRecent({ repoPath, maxCommits: 80, authorPattern: authorPattern || undefined }) : [];
        const previewRule = normalizeRuleDraft(draft);
        if (ruleNeedsBranches(previewRule) && !branchesContainsEnabled) {
          console.log("");
          console.log("提示：该规则依赖“分支 contains 推断”，但当前开关为禁用（默认）。预览会退化为仅基于 subject 推断，可能出现大量 unknown。");
          console.log("如需启用：其他配置 -> 管理：提交分组规则 -> 开关：启用分支 contains 推断（很慢）。");
          console.log("");
        }
        const grouped = groupCommitsByRule(commits, { rule: previewRule, repoPath, branchesContainsEnabled });
        console.log("");
        console.log(formatGroupingPreview(grouped as any, String(draft.unknownKey ?? "unknown").trim() || "unknown"));
        console.log("");
        await pause(inquirer);
      }
    }
  }

  const { ok } = await inquirer.prompt([{ type: "confirm", name: "ok", message: "保存这条规则？", default: true }]);
  if (!ok) return;

  const nextRules = [...rules, normalizeRuleDraft(draft)];
  updateFeaturesConfig({ grouping: { rules: nextRules } });

  const currentDefault = String(groupingCfg.defaultRuleId ?? "").trim();
  const suggestDefault = !currentDefault || currentDefault === "unknown";
  const { setDefault } = await inquirer.prompt([
    { type: "confirm", name: "setDefault", message: `设为默认规则？（生成摘要/速览会优先用默认规则）`, default: suggestDefault },
  ]);
  if (setDefault) updateFeaturesConfig({ grouping: { defaultRuleId: id } });

  console.log("已保存。");
}

async function manageRuleExtractorsInteractive(inquirer: any, rule: any): Promise<any> {
  const nextRule = normalizeRuleDraft(rule);
  for (;;) {
    const exs: any[] = Array.isArray(nextRule.extractors) ? nextRule.extractors : [];
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: `Extractors（${nextRule.name || nextRule.id}）\n\n${exs.map((e, i) => `${i + 1}. ${formatExtractorLabel(e)}`).join("\n") || "（空）"}`,
        choices: [
          { name: "新增 regex extractor", value: "addRegex" },
          { name: "新增 builtin: legacyRequirement", value: "addBuiltinLegacy" },
          { name: "编辑 regex extractor", value: "editRegex" },
          { name: "删除 extractor", value: "remove" },
          makeBackChoice({ value: "back" }),
        ],
      },
    ]);

    if (action === "back") return nextRule;

    if (action === "addRegex") {
      const ex = await promptRegexExtractor(inquirer, null);
      nextRule.extractors = [...exs, ex];
      continue;
    }

    if (action === "addBuiltinLegacy") {
      nextRule.extractors = [...exs, { kind: "builtin", id: "legacyRequirement" }];
      continue;
    }

    if (action === "editRegex") {
      const regexIdxs = exs
        .map((e, i) => ({ e, i }))
        .filter((x) => x.e && x.e.kind === "regex")
        .map((x) => x.i);
      if (!regexIdxs.length) {
        console.log("当前没有 regex extractor。");
        continue;
      }
      const { picked } = await inquirer.prompt([
        {
          type: "list",
          name: "picked",
          loop: false,
          message: "选择要编辑的 regex extractor",
          choices: regexIdxs.map((i) => ({ name: `${i + 1}. ${formatExtractorLabel(exs[i])}`, value: i })),
        },
      ]);
      const idx = Number(picked);
      if (!Number.isFinite(idx) || idx < 0 || idx >= exs.length) continue;
      const updated = await promptRegexExtractor(inquirer, exs[idx]);
      nextRule.extractors = exs.map((e, i) => (i === idx ? updated : e));
      continue;
    }

    if (action === "remove") {
      if (!exs.length) continue;
      const { picked } = await inquirer.prompt([
        {
          type: "list",
          name: "picked",
          loop: false,
          message: "选择要删除的 extractor",
          choices: exs.map((e, i) => ({ name: `${i + 1}. ${formatExtractorLabel(e)}`, value: i })).concat([{ name: "取消", value: -1 }]),
        },
      ]);
      const idx = Number(picked);
      if (!Number.isFinite(idx) || idx < 0 || idx >= exs.length) continue;
      const next = exs.filter((_, i) => i !== idx);
      if (!next.length) {
        console.log("至少保留一个 extractor。");
        continue;
      }
      nextRule.extractors = next;
      continue;
    }
  }
}

async function editGroupingRuleInteractive(inquirer: any, rule: any): Promise<any> {
  let nextRule = normalizeRuleDraft(rule);
  for (;;) {
    const table = formatKeyValueTable([
      { k: "id", v: nextRule.id },
      { k: "name", v: nextRule.name },
      { k: "enabled", v: nextRule.enabled ? "true" : "false" },
      { k: "displayStyle", v: nextRule.displayStyle },
      { k: "unknownKey", v: nextRule.unknownKey },
      { k: "extractors", v: String(Array.isArray(nextRule.extractors) ? nextRule.extractors.length : 0) },
    ]);
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: `编辑规则\n\n${table}`,
        choices: [
          { name: "修改 name", value: "name" },
          { name: "开关 enabled", value: "toggle" },
          { name: "修改 displayStyle", value: "displayStyle" },
          { name: "修改 unknownKey", value: "unknownKey" },
          { name: "管理 extractors", value: "extractors" },
          makeBackChoice({ value: "back" }),
        ],
      },
    ]);

    if (action === "back") return nextRule;

    if (action === "name") {
      const { name } = await inquirer.prompt([{ type: "input", name: "name", message: "规则名称", default: nextRule.name, validate: (v: unknown) => (String(v).trim() ? true : "必填") }]);
      nextRule = { ...nextRule, name: String(name ?? "").trim() };
      continue;
    }

    if (action === "toggle") {
      nextRule = { ...nextRule, enabled: !nextRule.enabled };
      continue;
    }

    if (action === "displayStyle") {
      const { style } = await inquirer.prompt([
        {
          type: "list",
          name: "style",
          message: "显示样式",
          choices: [makeCliChoice({ title: "plain", value: "plain" }), makeCliChoice({ title: "requirementKey", description: "zentao:xxx 显示成 xxx", value: "requirementKey" })],
          default: nextRule.displayStyle === "requirementKey" ? 1 : 0,
        },
      ]);
      nextRule = { ...nextRule, displayStyle: String(style ?? "plain").trim() === "requirementKey" ? "requirementKey" : "plain" };
      continue;
    }

    if (action === "unknownKey") {
      const { unknownKey } = await inquirer.prompt([{ type: "input", name: "unknownKey", message: "未匹配分组 key", default: nextRule.unknownKey, validate: (v: unknown) => (String(v).trim() ? true : "必填") }]);
      nextRule = { ...nextRule, unknownKey: String(unknownKey ?? "").trim() || "unknown" };
      continue;
    }

    if (action === "extractors") {
      nextRule = await manageRuleExtractorsInteractive(inquirer, nextRule);
      continue;
    }
  }
}

async function manageGroupingRulesInteractive(inquirer: any): Promise<void> {
  for (;;) {
    const config = loadConfig();
    const groupingCfg = config?.features?.grouping ?? { enabled: false, defaultRuleId: "", rules: [] };
    const groupingEnabled = (groupingCfg as any)?.enabled !== false;
    const branchesContainsEnabled = Boolean((groupingCfg as any)?.branchesContainsEnabled);
    const rules = (Array.isArray(groupingCfg.rules) ? groupingCfg.rules : []).filter(Boolean);
    const defaultRuleId = String(groupingCfg.defaultRuleId ?? "").trim();
    const defaultRuleName = rules.find((r: any) => r && r.id === defaultRuleId)?.name || "";
    const header = `提交分组规则\n\n功能状态：${groupingEnabled ? "启用" : "禁用"}\n分支 contains 推断：${branchesContainsEnabled ? "启用（可能很慢）" : "禁用（推荐）"}\n默认规则：${defaultRuleName ? `${defaultRuleName} (${defaultRuleId})` : (defaultRuleId || "无")}\n规则数：${rules.length}\n\n推荐：先用“快速开始”生成一条能跑起来的规则，再按需要微调。`;

    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: header,
        choices: [
          makeCliChoice({ title: "快速开始", status: "推荐", value: "wizard" }),
          makeCliChoice({ title: "开关：分组功能", status: groupingEnabled ? "禁用" : "启用", value: "toggleEnabled" }),
          makeCliChoice({ title: "开关：分支 contains 推断", status: branchesContainsEnabled ? "禁用" : "启用", description: "很慢", value: "toggleBranchesContains" }),
          makeCliChoice({ title: "新增规则", description: "高级：自定义 regex", value: "add" }),
          { name: "编辑规则", value: "edit" },
          { name: "删除规则", value: "remove" },
          { name: "设置默认规则", value: "setDefault" },
          makeBackChoice({ value: "back" }),
        ],
      },
    ]);

    if (action === "back") return;

    if (action === "wizard") {
      await addGroupingRuleWizardInteractive(inquirer);
      continue;
    }

    if (action === "toggleEnabled") {
      updateFeaturesConfig({ grouping: { enabled: !groupingEnabled } });
      console.log("已保存。");
      continue;
    }

    if (action === "toggleBranchesContains") {
      const next = !branchesContainsEnabled;
      updateFeaturesConfig({ grouping: { branchesContainsEnabled: next } });
      console.log("已保存。");
      if (next) {
        console.log("提示：启用后，凡是规则使用 branches/builtin 作为来源，都会对提交执行 git branch --contains 查询，提交多时会明显变慢。");
      }
      continue;
    }

    if (action === "add") {
      const answers = await inquirer.prompt([
        { type: "input", name: "id", message: "规则 id（唯一；建议英文短横线）", validate: (v: unknown) => (String(v).trim() ? true : "必填") },
        { type: "input", name: "name", message: "规则名称（展示用）", validate: (v: unknown) => (String(v).trim() ? true : "必填") },
        { type: "confirm", name: "enabled", message: "默认启用？", default: true },
        {
          type: "list",
          name: "displayStyle",
          message: "显示样式（只影响展示，不改变分组 key 本身）",
          choices: [
            makeCliChoice({ title: "plain", description: "原样显示", value: "plain" }),
            makeCliChoice({ title: "requirementKey", description: "zentao:123 显示成 123", value: "requirementKey" }),
          ],
          default: 0,
        },
        { type: "input", name: "unknownKey", message: "未匹配分组 key（建议保留 unknown）", default: "unknown", validate: (v: unknown) => (String(v).trim() ? true : "必填") },
      ]);
      const id = String(answers.id ?? "").trim();
      if (rules.some((r: any) => String(r?.id ?? "") === id)) {
        console.log(`已存在同名 id：${id}`);
        continue;
      }
      const ex = await promptRegexExtractor(inquirer, null);
      const draft = {
        id,
        name: String(answers.name ?? "").trim(),
        enabled: Boolean(answers.enabled),
        displayStyle: String(answers.displayStyle ?? "plain").trim() === "requirementKey" ? "requirementKey" : "plain",
        unknownKey: String(answers.unknownKey ?? "unknown").trim() || "unknown",
        extractors: [ex],
      };
      const check = validateRule(draft);
      if (!check.ok) {
        console.log(`规则无效：${check.reason}`);
        continue;
      }
      updateFeaturesConfig({ grouping: { rules: [...rules, normalizeRuleDraft(draft)] } });
      console.log("已保存。");
      continue;
    }

    if (action === "edit") {
      if (!rules.length) {
        console.log("当前没有规则。");
        continue;
      }
      const { picked } = await inquirer.prompt([
        {
          type: "list",
          name: "picked",
          loop: false,
          message: "选择要编辑的规则",
          choices: rules
            .map((r: any) => makeCliChoice({ title: String(r.name ?? "").trim() || String(r.id ?? "").trim(), stats: r.name ? String(r.id ?? "") : "", value: String(r.id ?? "") }))
            .concat([{ name: "取消", value: "" }]),
        },
      ]);
      const id = String(picked ?? "").trim();
      if (!id) continue;
      const rule = rules.find((r: any) => String(r?.id ?? "") === id);
      if (!rule) continue;
      const edited = await editGroupingRuleInteractive(inquirer, rule);
      const check = validateRule(edited);
      if (!check.ok) {
        console.log(`规则无效：${check.reason}`);
        continue;
      }
      const nextRules = rules.map((r: any) => (String(r?.id ?? "") === id ? normalizeRuleDraft(edited) : r));
      updateFeaturesConfig({ grouping: { rules: nextRules } });
      console.log("已保存。");
      continue;
    }

    if (action === "remove") {
      if (!rules.length) {
        console.log("当前没有规则。");
        continue;
      }
      const { picked } = await inquirer.prompt([
        {
          type: "list",
          name: "picked",
          loop: false,
          message: "选择要删除的规则",
          choices: rules
            .map((r: any) => makeCliChoice({ title: String(r.name ?? "").trim() || String(r.id ?? "").trim(), stats: r.name ? String(r.id ?? "") : "", value: String(r.id ?? "") }))
            .concat([{ name: "取消", value: "" }]),
        },
      ]);
      const id = String(picked ?? "").trim();
      if (!id) continue;
      const { ok } = await inquirer.prompt([{ type: "confirm", name: "ok", message: `确认删除规则 ${id}？`, default: false }]);
      if (!ok) continue;
      const nextRules = rules.filter((r: any) => String(r?.id ?? "") !== id);
      const nextDefault = defaultRuleId === id ? "" : defaultRuleId;
      updateFeaturesConfig({ grouping: { rules: nextRules, defaultRuleId: nextDefault } });
      console.log("已保存。");
      continue;
    }

    if (action === "setDefault") {
      const enabledRules = rules.filter((r: any) => r && r.enabled);
      if (!enabledRules.length) {
        console.log("没有 enabled 的规则可设为默认。");
        continue;
      }
      const idx = Math.max(0, enabledRules.findIndex((r: any) => String(r?.id ?? "") === defaultRuleId));
      const { picked } = await inquirer.prompt([
        {
          type: "list",
          name: "picked",
          loop: false,
          message: "选择默认规则（仅从 enabled 规则中选）",
          choices: enabledRules.map((r: any) =>
            makeCliChoice({ title: String(r.name ?? "").trim() || String(r.id ?? "").trim(), stats: r.name ? String(r.id ?? "") : "", value: String(r.id ?? "") }),
          ),
          default: idx,
        },
      ]);
      const id = String(picked ?? "").trim();
      if (!id) continue;
      updateFeaturesConfig({ grouping: { defaultRuleId: id } });
      console.log("已保存。");
      continue;
    }
  }
}

export async function manageOtherInteractive(inquirer: any): Promise<void> {
  for (;;) {
    const config = loadConfig();
    const outputDir = String(config?.report?.outputDir ?? "").trim();
    const outputMode = String(config?.report?.outputMode ?? "stdout").trim();
    const scanRootDir = String(config?.projectsScan?.rootDir ?? "").trim();
    const scanDepth = Number.isFinite(Number(config?.projectsScan?.depth))
      ? Math.max(0, Math.floor(Number(config.projectsScan.depth)))
      : 1;
    const groupingCfg = config?.features?.grouping ?? { enabled: true, defaultRuleId: "", rules: [] };
    const branchesContainsEnabled = Boolean((groupingCfg as any)?.branchesContainsEnabled);
    const rules = (Array.isArray(groupingCfg.rules) ? groupingCfg.rules : []).filter((r) => r && r.enabled);
    const defaultRuleId = String(groupingCfg.defaultRuleId ?? "").trim();
    const defaultRuleName = rules.find((r) => r.id === defaultRuleId)?.name || rules[0]?.name || "无";
    const hasRules = Boolean(rules.length);
    const groupingEnabled = (groupingCfg as any)?.enabled !== false;

    const table = formatKeyValueTable([
      { k: "报告默认导出目录", v: outputDir || "（当前目录）" },
      { k: "报告默认输出方式", v: `${formatOutputMode(outputMode)} (${outputMode || "stdout"})` },
      { k: "扫描默认 root", v: scanRootDir || "（当前目录）" },
      { k: "扫描默认 depth", v: String(scanDepth) },
      { k: "提交分组规则", v: hasRules ? `${groupingEnabled ? "已启用" : "已禁用"}（默认规则：${defaultRuleName}）` : "未配置" },
      { k: "分支 contains 推断", v: branchesContainsEnabled ? "已启用（可能很慢）" : "已禁用（推荐）" },
    ]);

    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: `其他配置\n\n${table}`,
        choices: [
          { name: "设置报告默认导出目录", value: "reportDir" },
          { name: "设置报告默认输出方式", value: "reportMode" },
          { name: "设置扫描默认 root / depth", value: "scanDefaults" },
          makeCliChoice({ title: "管理：提交分组规则", description: "新增/编辑/删除", value: "manageGroupingRules" }),
          makeBackChoice({ value: "back" }),
        ],
      },
    ]);

    if (action === "back") return;

    if (action === "reportDir") {
      const { dir } = await inquirer.prompt([{ type: "input", name: "dir", message: "报告默认导出目录（留空=当前目录）", default: outputDir }]);
      updateReportConfig({ outputDir: String(dir ?? "").trim() });
      console.log("已保存。");
      continue;
    }

    if (action === "reportMode") {
      const choices = [
        { name: "仅终端显示", value: "stdout" },
        { name: "仅导出文件", value: "file" },
        { name: "终端 + 文件", value: "both" },
      ];
      const idx = Math.max(0, choices.findIndex((c) => c.value === outputMode));
      const { mode } = await inquirer.prompt([{ type: "list", name: "mode", message: "报告默认输出方式", choices, default: idx }]);
      updateReportConfig({ outputMode: String(mode).trim() });
      console.log("已保存。");
      continue;
    }

    if (action === "scanDefaults") {
      const defaults = { rootDir: scanRootDir || process.cwd(), depth: String(scanDepth) };
      const answers = await inquirer.prompt([
        { type: "input", name: "rootDir", message: "扫描路径 root（留空=当前目录）", default: defaults.rootDir },
        {
          type: "input",
          name: "depth",
          message: "扫描深度 depth（>=0）",
          default: defaults.depth,
          validate: (v: unknown) => (Number(String(v).trim()) >= 0 ? true : "必须是 >= 0 的数字"),
        },
      ]);
      const rootInput = String(answers.rootDir ?? "").trim();
      const resolved = rootInput ? path.resolve(rootInput) : "";
      const depth = Math.max(0, Math.floor(Number(String(answers.depth ?? "").trim())));
      updateProjectsScanConfig({ rootDir: resolved, depth });
      console.log("已保存。");
      continue;
    }

    if (action === "manageGroupingRules") {
      await manageGroupingRulesInteractive(inquirer);
      continue;
    }
  }
}
