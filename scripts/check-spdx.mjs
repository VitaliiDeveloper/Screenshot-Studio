// SPDX-License-Identifier: Apache-2.0
import console from "node:console";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HEADER = "// SPDX-License-Identifier: Apache-2.0";
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mjs"]);
const SKIPPED_DIRECTORY_NAMES = new Set([".git", ".next", "node_modules"]);
const SKIPPED_PREFIXES = ["packages/cli/package/", "e2e/.tmp/"];
const SKIPPED_PATHS = new Set(["apps/web/next-env.d.ts"]);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const write = process.argv.includes("--write");

function normalizedRelative(path) {
  return relative(repoRoot, path).split("\\").join("/");
}

function isSkipped(path) {
  const relativePath = normalizedRelative(path);
  return SKIPPED_PATHS.has(relativePath)
    || SKIPPED_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

async function collect(directory, files) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((first, second) => first.name.localeCompare(second.name));
  for (const entry of entries) {
    if (entry.isDirectory() && SKIPPED_DIRECTORY_NAMES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (isSkipped(path)) continue;
    if (entry.isDirectory()) {
      await collect(path, files);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
      files.push(path);
    }
  }
}

function addHeader(source) {
  if (source.startsWith("#!")) {
    const lineEnd = source.indexOf("\n");
    if (lineEnd === -1) return `${source}\n${HEADER}\n`;
    return `${source.slice(0, lineEnd + 1)}${HEADER}\n${source.slice(lineEnd + 1)}`;
  }
  return `${HEADER}\n${source}`;
}

const files = [];
await collect(repoRoot, files);
const missing = [];

for (const path of files) {
  const source = await readFile(path, "utf8");
  if (source.split("\n").slice(0, 3).includes(HEADER)) continue;
  if (write) await writeFile(path, addHeader(source));
  else missing.push(normalizedRelative(path));
}

if (missing.length > 0) {
  console.error(`Missing SPDX header in ${missing.length} source file(s):\n${missing.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`${write ? "Applied" : "Verified"} SPDX headers for ${files.length} source files.`);
}
