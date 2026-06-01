# commit-log-daily

从多个 Git 仓库聚合提交记录，生成日报/周报/月报/年报。支持本地整理和 AI 智能归纳。

## 安装

```bash
npm install -g commit-log-daily
```

需要 Node.js 18+。

## 快速开始

```bash
# 进入交互模式
clogd

# 或者
cld
commit-log-daily
```

首次运行会引导你添加 Git 仓库并配置提交人过滤。之后就可以直接生成报告了。

## 用法

### 交互模式

```bash
clogd
```

进入交互菜单，所有操作都在里面。

### 命令行

```bash
# 查看项目列表
clogd projects list

# 添加项目
clogd projects add --name myapp --path D:\repos\myapp

# 删除项目
clogd projects remove --name myapp

# 交互式生成报告
clogd report
```

### 快捷别名

| 命令      | 等价                 |
| ------- | ------------------ |
| `clogd` | `commit-log-daily` |
| `cld`   | `commit-log-daily` |

## 功能

### 多仓库管理

管理任意数量的 Git 仓库，支持手动添加和目录扫描导入。

### 时间范围

- 日报：今天 00:00 至今
- 周报：本周一 00:00 至今
- 月报：本月 1 号 00:00 至今
- 年报：今年 1 月 1 日 00:00 至今
- 自定义：指定起止日期

### 提交人过滤

通过 git author 过滤只看自己的提交。首次设置后自动保存。

### AI 智能归纳

配置 OpenAI 兼容的 API 后，AI 会分析你的提交记录并给出结构化的归纳总结，而不是简单罗列。

环境变量方式（推荐）：

```bash
set AI_API_KEY=sk-xxx
set AI_BASE_URL=https://api.openai.com
set AI_MODEL=gpt-4.1-mini
```

也可以在交互菜单的 "AI Config" 中配置。

### 输出方式

- 仅终端显示
- 仅导出 Markdown 文件
- 终端 + 文件

### 提交分组

支持自定义正则规则从提交主题或分支名中提取分类 Key，将提交按功能模块/需求/标签分组。

### 无意义提交过滤

自动过滤 Merge branch、WIP 等噪音提交，让报告更干净。

## 配置

配置文件位于 `~/.commit-log-daily/config.json`。交互菜单中操作即可，无需手动编辑。

#
