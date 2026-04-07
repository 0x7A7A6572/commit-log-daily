import path from "node:path";

export function buildHelpText({ argv, configFilePath = "" }) {
  const bin = path.basename(argv?.[1] || "commit-log-daily");
  const lines = [
    "",
    "commit-log-daily",
    "",
    ...(String(configFilePath).trim() ? [`配置文件：${String(configFilePath).trim()}`, ""] : []),
    "用法：",
    `  ${bin}                          进入交互模式`,
    `  ${bin} projects list            查看项目列表`,
    `  ${bin} projects add --name A --path D:\\repo`,
    `  ${bin} projects remove --name A`,
    `  ${bin} report                   交互生成报告`,
    "",
    "环境变量（可选，用于 AI 摘要）：",
    "  AI_API_KEY / AI_BASE_URL / AI_MODEL",
    "",
  ];
  return lines.join("\n");
}

export function printHelp(argv, configFilePath = "") {
  console.log(buildHelpText({ argv, configFilePath }));
}

export function printAppInfo({ argv, configFilePath = "" }) {
  console.log(buildHelpText({ argv, configFilePath }));
}
