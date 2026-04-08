import path from "node:path";
import { writeTextFile } from "../utils/fs.js";

export function writeReportToFile(input: { filePath: string; content: string }): string {
  writeTextFile({ filePath: input.filePath, content: input.content });
  return path.resolve(input.filePath);
}
