import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, "..", "package.json");
const versionPath = resolve(__dirname, "..", "src", "version.ts");

const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const content = `export const VERSION: string = ${JSON.stringify(pkg.version)};\n`;

writeFileSync(versionPath, content, "utf-8");
console.log(`[gen-version] wrote VERSION=${pkg.version} → src/version.ts`);
