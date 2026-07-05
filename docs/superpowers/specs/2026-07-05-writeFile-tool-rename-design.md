# writeFile 工具重命名与健壮性增强

**日期**: 2026-07-05
**问题**: LLM 在 generate 阶段不认识 `exportFile` 是文件写入工具，声称"没有写入工具"，导致报告无法保存到磁盘。

## 背景

项目已有 `exportFile` 工具注册在 `GENERATE_TOOLS` 中，但存在两个问题：

1. **命名与描述不直观** — 工具名 `exportFile` 描述为"导出报告"，LLM 未能将其与"写入磁盘"对应
2. **输出目录必须事先存在** — `outputDir` 不存在时直接抛错，用户体验差

## 设计

### 改动范围

| 文件 | 改动 |
|---|---|
| `src/agent/tools/exportFile.ts` | 工具名改为 `writeFile`，描述改用"写入"/"保存"等直白词汇；输出目录不存在时自动递归创建 |
| `src/agent/prompts/system.ts` | `GENERATE_SYSTEM_PROMPT` 中 `exportFile` → `writeFile`，"导出" → "写入/保存" |
| `src/agent/base.ts` | import 名同步改为 `writeFileTool`，`GENERATE_TOOLS` 数组同步 |

### 工具细节

**名称**: `writeFile`（原 `exportFile`）

**描述**: `将内容写入磁盘保存为文件。支持写入任意文本内容到指定路径。`

**路径处理**: 输出目录不存在时自动调用 `fs.mkdirSync(outputDir, { recursive: true })` 创建，不再抛错。

**参数不变**: `content`（必填，要写入的内容）、`filename`（可选，不含扩展名，默认时间戳）。

### Prompt 改动

`GENERATE_SYSTEM_PROMPT` 第 4-5 条：
- "是否需要导出为文件" → "是否需要将报告保存为文件"
- "调用 exportFile 工具" → "调用 writeFile 工具，传入报告内容和文件名即可"
- 工具列表处 `exportFile` → `writeFile`

`COLLECT_SYSTEM_PROMPT` 不需要改动。

### 不变的部分

- 工具可用阶段不变：仍然只在 `generate` 阶段绑定
- Schema 参数不变：`content` + `filename`
- 文件命名逻辑不变：`sanitizeFilename` + `.md` 后缀
- 配置读取方式不变：从 `readConfig().report.outputDir` 获取
