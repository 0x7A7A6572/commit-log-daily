import fs from 'node:fs';
import path from 'node:path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/** 最多发现的仓库数，超出截断并标记 */
const MAX_REPOS = 200;

/** findGitRepos 返回的结果项 */
interface FoundRepo {
  name: string;
  path: string;
}

/** 扫描根目录，发现一级子目录中的 Git 仓库 */
function scanGitRepos(rootPath: string): FoundRepo[] {
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });

  const repos: FoundRepo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const fullPath = path.join(rootPath, entry.name);
    const gitDir = path.join(fullPath, '.git');

    if (fs.existsSync(gitDir)) {
      repos.push({
        name: entry.name,
        path: fullPath,
      });
    }
  }

  return repos;
}

/** 扫描目录发现 Git 仓库的工具 */
export const findGitReposTool = tool(
  async ({ rootPath }) => {
    // 校验：必须是绝对路径
    if (!path.isAbsolute(rootPath)) {
      return `请提供绝对路径，收到: "${rootPath}"`;
    }

    // 校验：路径必须存在
    if (!fs.existsSync(rootPath)) {
      return `路径不存在: ${rootPath}`;
    }

    // 校验：必须是目录
    let stat: fs.Stats;
    try {
      stat = fs.statSync(rootPath);
    } catch {
      return `无法访问路径: ${rootPath}`;
    }
    if (!stat.isDirectory()) {
      return `路径不是目录: ${rootPath}`;
    }

    let repos: FoundRepo[];
    try {
      repos = scanGitRepos(rootPath);
    } catch {
      return `无法扫描目录: ${rootPath}`;
    }

    if (repos.length === 0) {
      return `在 ${rootPath} 下未找到 Git 仓库`;
    }

    const truncated = repos.length > MAX_REPOS;
    const visible = truncated ? repos.slice(0, MAX_REPOS) : repos;

    return JSON.stringify({
      repos: visible,
      totalCount: visible.length,
      truncated,
      truncatedHint: truncated
        ? `结果已截断：实际发现 ${repos.length} 个仓库，仅返回前 ${MAX_REPOS} 个。建议指定更具体的目录路径以获取完整列表。`
        : undefined,
    });
  },
  {
    name: 'findGitRepos',
    description:
      '扫描指定根目录下的一级子目录，发现其中包含 .git 的 Git 仓库。返回仓库名称和路径的列表。用于用户提供目录而非具体项目路径时的自动发现。',
    schema: z.object({
      rootPath: z
        .string()
        .describe('要扫描的根目录，必须是绝对路径，如 "f:/codes/"'),
    }),
  },
);
