import path from "node:path";
import process from "node:process";

import { loadConfig, setGitAuthorFilter, updateReportConfig, upsertProject, validateRepoPath } from "../config.js";
import { detectAuthorPattern, getRangeByPreset, parseDateInput } from "../git.js";
import { isAiConfigured, isAiStreamEnabled } from "../ai.js";
import { formatDateYmd, formatRangeLabel, resolveOutputPath, sanitizeFileName } from "../utils/cli.js";
import { buildReportContent, collectCommits } from "../report/service.js";
import { writeReportToFile } from "../report/output.js";
import { setupAiOnce } from "./ai.js";

async function ensureAtLeastOneProjectInteractive(inquirer) {
  const config = loadConfig();
  if (config.projects.length) return config;

  console.log("当前还没有配置任何项目。先添加一个。");
  const answers = await inquirer.prompt([
    { type: "input", name: "name", message: "项目名", validate: (v) => (String(v).trim() ? true : "必填") },
    { type: "input", name: "repoPath", message: "本地仓库路径", validate: (v) => (String(v).trim() ? true : "必填") },
  ]);
  const repoCheck = validateRepoPath(answers.repoPath);
  if (!repoCheck.ok) console.log(`提示：路径校验失败：${repoCheck.reason}（仍会写入配置，但后续扫描可能失败）`);
  upsertProject({ name: answers.name, repoPath: answers.repoPath });
  return loadConfig();
}

async function chooseRangeInteractive(inquirer) {
  const { preset } = await inquirer.prompt([
    {
      type: "list",
      name: "preset",
      message: "选择摘要类型",
      choices: [
        { name: "日报（今天 00:00 至今）", value: "daily" },
        { name: "周报（本周一 00:00 至今）", value: "weekly" },
        { name: "月报（本月 1 号 00:00 至今）", value: "monthly" },
        { name: "年报（今年 1 月 1 号 00:00 至今）", value: "yearly" },
        { name: "自定义（输入起止日期）", value: "custom" },
      ],
    },
  ]);

  if (preset !== "custom") {
    const range = getRangeByPreset(preset);
    return { preset, range };
  }

  const answers = await inquirer.prompt([
    { type: "input", name: "start", message: "开始日期（YYYY-MM-DD）", validate: (v) => (parseDateInput(v) ? true : "格式不对") },
    { type: "input", name: "end", message: "结束日期（YYYY-MM-DD，可留空=今天）", validate: (v) => (!String(v).trim() || parseDateInput(v) ? true : "格式不对") },
  ]);

  const start = parseDateInput(answers.start);
  const endInput = parseDateInput(answers.end);
  const end = endInput ?? new Date();
  end.setHours(23, 59, 59, 999);
  start.setHours(0, 0, 0, 0);

  if (start.getTime() > end.getTime()) throw new Error("开始日期不能晚于结束日期");
  return { preset, range: { start, end } };
}

function getDefaultTitle(preset, rangeLabel) {
  const map = {
    daily: `日报 ${formatDateYmd(new Date())}`,
    weekly: `周报 ${rangeLabel}`,
    monthly: `月报 ${rangeLabel}`,
    yearly: `年报 ${rangeLabel}`,
    custom: `摘要 ${rangeLabel}`,
  };
  return map[preset] ?? `摘要 ${rangeLabel}`;
}

async function chooseOutputInteractive(inquirer, title) {
  const config = loadConfig();
  const defaultDir = String(config?.report?.outputDir ?? "").trim();
  const defaultFileName = `${sanitizeFileName(title)}.md`;

  const { outputMode } = await inquirer.prompt([
    {
      type: "list",
      name: "outputMode",
      message: "输出方式",
      choices: [
        { name: "仅终端显示", value: "stdout" },
        { name: "仅导出文件", value: "file" },
        { name: "终端 + 文件", value: "both" },
      ],
    },
  ]);

  if (outputMode === "stdout") return { outputMode, filePath: "" };

  const suggestedPath = resolveOutputPath({ outputDir: defaultDir, fileName: defaultFileName });
  const { filePath } = await inquirer.prompt([
    { type: "input", name: "filePath", message: "导出文件路径", default: suggestedPath, validate: (v) => (String(v).trim() ? true : "必填") },
  ]);

  const normalized = path.resolve(String(filePath).trim());
  const outDir = path.dirname(normalized);
  if (outDir && outDir !== defaultDir) {
    const { remember } = await inquirer.prompt([
      { type: "confirm", name: "remember", message: `记住默认输出目录为：${outDir}？`, default: true },
    ]);
    if (remember) updateReportConfig({ outputDir: outDir });
  }

  return { outputMode, filePath: normalized };
}

export async function generateReportInteractive(inquirer) {
  const config = await ensureAtLeastOneProjectInteractive(inquirer);
  const { selected } = await inquirer.prompt([
    {
      type: "checkbox",
      name: "selected",
      message: "选择要生成摘要的项目（可多选）",
      choices: config.projects.map((p) => ({ name: `${p.name} (${p.path})`, value: p.name })),
      validate: (v) => (Array.isArray(v) && v.length ? true : "至少选一个"),
    },
  ]);

  const { preset, range } = await chooseRangeInteractive(inquirer);
  const rangeLabel = formatRangeLabel(range);

  const { title } = await inquirer.prompt([
    { type: "input", name: "title", message: "标题", default: getDefaultTitle(preset, rangeLabel) },
  ]);

  const selectedProjects = config.projects.filter((p) => selected.includes(p.name));

  const cfg1 = loadConfig();
  let authorPattern = String(cfg1?.git?.author ?? "").trim();
  const wasAuthorEmpty = !authorPattern;
  const { onlyMine } = await inquirer.prompt([
    { type: "confirm", name: "onlyMine", message: "只统计我的提交（按作者过滤）？", default: true },
  ]);

  if (onlyMine) {
    if (!authorPattern) {
      const candidates = [];
      for (const p of selectedProjects) {
        const detected = detectAuthorPattern(p.path);
        if (detected) candidates.push({ name: `${p.name}: ${detected}`, value: detected });
      }
      if (candidates.length) {
        const { picked } = await inquirer.prompt([
          { type: "list", name: "picked", message: "检测到 git 用户信息，选择一个用来过滤", choices: [...candidates, { name: "手动输入（邮箱/姓名/正则）", value: "__manual__" }] },
        ]);
        if (picked === "__manual__") {
          const { author } = await inquirer.prompt([
            { type: "input", name: "author", message: "提交人过滤（传给 git log --author=...）", validate: (v) => (String(v).trim() ? true : "必填") },
          ]);
          authorPattern = String(author).trim();
        } else {
          authorPattern = String(picked).trim();
        }
      } else {
        const { author } = await inquirer.prompt([
          { type: "input", name: "author", message: "未检测到 user.email/user.name，请输入提交人过滤（邮箱/姓名/正则）", validate: (v) => (String(v).trim() ? true : "必填") },
        ]);
        authorPattern = String(author).trim();
      }

      if (wasAuthorEmpty && authorPattern) {
        const { persist } = await inquirer.prompt([
          { type: "confirm", name: "persist", message: `保存为默认过滤（${authorPattern}）？`, default: true },
        ]);
        if (persist) setGitAuthorFilter(authorPattern);
      }
    }
  } else {
    authorPattern = "";
  }

  const cfg2 = loadConfig();
  let useAiAvailable = isAiConfigured(cfg2.ai);
  const { useAi } = await inquirer.prompt([
    { type: "confirm", name: "useAi", message: useAiAvailable ? "使用 AI 进行归纳整理？" : "未检测到 AI 配置，使用本地整理？", default: useAiAvailable },
  ]);
  if (useAi && !useAiAvailable) {
    const { configureNow } = await inquirer.prompt([
      { type: "confirm", name: "configureNow", message: "现在配置 AI？（配置后会使用 AI，否则继续本地整理）", default: true },
    ]);
    if (configureNow) await setupAiOnce(inquirer);
    useAiAvailable = isAiConfigured(loadConfig().ai);
  }

  const { outputMode, filePath } = await chooseOutputInteractive(inquirer, title);

  const { projectsWithCommits, errors } = collectCommits({ projects: selectedProjects, range, authorPattern });
  if (errors.length) {
    console.log("");
    console.log("扫描过程中有错误：");
    for (const e of errors) console.log(`- ${e.name}: ${e.message}`);
    console.log("");
  }

  const finalConfig = loadConfig();
  const streamEnabled = isAiStreamEnabled(finalConfig.ai);
  const shouldStreamToStdout = Boolean(useAi && useAiAvailable && streamEnabled && (outputMode === "stdout" || outputMode === "both"));
  if (shouldStreamToStdout) console.log("AI 输出（流式）：");

  const result = await buildReportContent({
    title,
    rangeLabel,
    authorPattern,
    projectsWithCommits,
    useAi: Boolean(useAi && useAiAvailable),
    aiConfig: finalConfig.ai,
    stream: shouldStreamToStdout,
    onAiToken: shouldStreamToStdout ? (t) => process.stdout.write(String(t ?? "")) : null,
  });
  const content = result.content;
  if (String(result.aiError ?? "").trim()) console.log(`\nAI 未使用，已降级为本地整理：${String(result.aiError).trim()}`);
  else if (result.usedAi) console.log("\nAI 已启用：已使用 AI 归纳整理");

  if (outputMode === "stdout" || outputMode === "both") {
    if (shouldStreamToStdout && result.usedAi) {
      console.log("");
      console.log("");
    } else {
      console.log("");
      console.log(content);
      console.log("");
    }
  }
  if (outputMode === "file" || outputMode === "both") {
    const saved = writeReportToFile({ filePath, content });
    console.log(`已导出：${saved}`);
  }
}
