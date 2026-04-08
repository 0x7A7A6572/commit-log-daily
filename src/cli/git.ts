import { clearGitAuthorFilter, loadConfig, setGitAuthorFilter, setGitNoiseFilter, type Project } from "../config.js";
import { detectAuthorPattern } from "../git.js";
import { formatKeyValueTable } from "../utils/cli.js";

export async function manageGitInteractive(inquirer: any): Promise<void> {
  for (;;) {
    const config = loadConfig();
    const currentAuthor = String(config?.git?.author ?? "").trim();
    const noiseEnabled = Boolean(config?.git?.filterNoise);
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
          { name: "设置提交人过滤（只看自己）", value: "set" },
          { name: "清空提交人过滤（看全员）", value: "clear" },
          { name: noiseEnabled ? "关闭过滤无意义提交" : "启用过滤无意义提交", value: "toggleNoise" },
          { name: "返回", value: "back" },
        ],
      },
    ]);

    if (action === "back") return;

    if (action === "clear") {
      clearGitAuthorFilter();
      console.log("已清空。");
      continue;
    }

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
  for (const p of list) {
    const detected = detectAuthorPattern(p.path);
    if (detected) choices.push({ name: `${p.name}: ${detected}`, value: detected });
  }
  choices.push({ name: "手动输入（邮箱/姓名/正则）", value: "__manual__" });

  const { picked } = await inquirer.prompt([
    {
      type: "list",
      name: "picked",
      message: choices.length > 1 ? "选择一个提交人标识" : "未检测到 user.email/user.name，手动输入",
      choices: choices.length > 1 ? choices : [{ name: "手动输入（邮箱/姓名/正则）", value: "__manual__" }],
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
