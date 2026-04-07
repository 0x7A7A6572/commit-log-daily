import path from "node:path";
import { writeTextFile } from "../utils/fs.js";

export function writeReportToFile({ filePath, content }) {
  writeTextFile({ filePath, content });
  return path.resolve(filePath);
}

