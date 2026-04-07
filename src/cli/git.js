import { clearGitAuthorFilter, loadConfig, setGitAuthorFilter } from "../config.js";
import { detectAuthorPattern } from "../git.js";

export async function manageGitInteractive(inquirer) {
  for (;;) {
    const config = loadConfig();
    const current = String(config?.git?.author ?? "").trim();
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: `Git 配置（提交人过滤：${current || "无"}）`,
        choices: [
          { name: "设置提交人过滤（只看自己）", value: "set" },
          { name: "清空提交人过滤（看全员）", value: "clear" },
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
  }
}

export async function configureAuthorInteractive(inquirer, projects) {
  const list = Array.isArray(projects) ? projects : [];
  const choices = [];
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
      { type: "input", name: "author", message: "提交人过滤（传给 git log --author=...）", validate: (v) => (String(v).trim() ? true : "必填") },
    ]);
    setGitAuthorFilter(author);
    console.log("已保存。");
    return String(author).trim();
  }

  setGitAuthorFilter(picked);
  console.log("已保存。");
  return String(picked).trim();
}

