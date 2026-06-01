import { loadConfig, setGitAuthorFilter, setGitNoiseFilter, type Project } from "../config.js";
import { detectAuthorPattern, listGitAuthorsRecent } from "../git.js";
import { formatKeyValueTable, makeBackChoice, makeCliChoice } from "../utils/cli.js";

export async function manageGitInteractive(inquirer: any): Promise<void> {
  for (;;) {
    const config = loadConfig();
    let currentAuthor = String(config?.git?.author ?? "").trim();
    const noiseEnabled = Boolean(config?.git?.filterNoise);
    if (!currentAuthor) {
      for (const p of Array.isArray(config.projects) ? config.projects : []) {
        const detected = detectAuthorPattern(String((p as any)?.path ?? ""));
        if (!detected) continue;
        setGitAuthorFilter(detected);
        currentAuthor = String(detected).trim();
        console.log(`已从本地 git 配置检测到提交人：${currentAuthor}`);
        break;
      }
    }
    const table = formatKeyValueTable([
      { k: "Author 过滤", v: currentAuthor || "无" },
      { k: "过滤无意义提交", v: noiseEnabled ? "开" : "关" },
    ]);
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: `Git 配置\n\n${table}`,
        choices: [
          makeCliChoice({ title: "设置提交人过滤", description: "只看自己", value: "set" }),
          { name: noiseEnabled ? "关闭过滤无意义提交" : "启用过滤无意义提交", value: "toggleNoise" },
          makeBackChoice({ value: "back" }),
        ],
      },
    ]);

    if (action === "back") return;

    if (action === "set") {
      await configureAuthorInteractive(inquirer, config.projects);
      continue;
    }

    if (action === "toggleNoise") {
      setGitNoiseFilter(!noiseEnabled);
      console.log(noiseEnabled ? "已关闭过滤。" : "已启用过滤。");
      continue;
    }
  }
}

export async function configureAuthorInteractive(inquirer: any, projects: Project[]): Promise<string> {
  const list = Array.isArray(projects) ? projects : [];
  const choices: Array<{ name: string; value: string }> = [];
  const seen = new Set<string>();
  for (const p of list) {
    const repoPath = String((p as any)?.path ?? "").trim();
    if (!repoPath) continue;
    const authors = listGitAuthorsRecent({ repoPath, maxCommits: 300 }).slice(0, 12);
    for (const a of authors) {
      const label = makeCliChoice({ title: `${p.name}: ${a.name}${a.email ? ` <${a.email}>` : ""}`, stats: a.count, value: a.email || a.name });
      const value = a.email || a.name;
      const key = `${repoPath}\t${value}`;
      if (!value) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      choices.push({ name: label.name, value });
    }
  }
  if (!choices.length) {
    for (const p of list) {
      const detected = detectAuthorPattern(p.path);
      if (detected) choices.push(makeCliChoice({ title: p.name, stats: detected, value: detected }));
    }
  }
  const manualChoice = makeCliChoice({ title: "手动输入", description: "邮箱/姓名/正则", value: "__manual__" });
  choices.push(manualChoice);

  const { picked } = await inquirer.prompt([
    {
      type: "list",
      name: "picked",
      message: choices.length > 1 ? "选择一个提交人标识（来自近期提交作者）" : "未检测到近期作者信息，手动输入",
      choices: choices.length > 1 ? choices : [manualChoice],
    },
  ]);

  if (picked === "__manual__") {
    const { author } = await inquirer.prompt([
      { type: "input", name: "author", message: "提交人过滤（传给 git log --author=...）", validate: (v: unknown) => (String(v).trim() ? true : "必填") },
    ]);
    setGitAuthorFilter(author);
    console.log("已保存。");
    return String(author).trim();
  }

  setGitAuthorFilter(picked);
  console.log("已保存。");
  return String(picked).trim();
}
