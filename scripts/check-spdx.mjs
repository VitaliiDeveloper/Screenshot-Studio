// SPDX-License-Identifier: Apache-2.0
import console from "node:console";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HEADER = "// SPDX-License-Identifier: Apache-2.0";
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mjs"]);
const SKIPPED_DIRECTORY_NAMES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".worktrees",
  "build",
  "dist",
  "node_modules",
  "out",
  "worktrees",
]);
const SKIPPED_PREFIXES = ["packages/cli/package/", "e2e/.tmp/"];
const SKIPPED_PATHS = new Set(["apps/web/next-env.d.ts"]);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function normalizedRelative(root, path) {
  return relative(root, path).split("\\").join("/");
}

function isSkipped(root, path) {
  const relativePath = normalizedRelative(root, path);
  return SKIPPED_PATHS.has(relativePath)
    || SKIPPED_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

async function collect(root, directory, files) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((first, second) => first.name.localeCompare(second.name));
  for (const entry of entries) {
    if (entry.isDirectory() && SKIPPED_DIRECTORY_NAMES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (isSkipped(root, path)) continue;
    if (entry.isDirectory()) {
      await collect(root, path, files);
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

export async function collectSourceFiles(root) {
  const absoluteRoot = resolve(root);
  const files = [];
  await collect(absoluteRoot, absoluteRoot, files);
  return files;
}

export async function checkSpdx({ root, write = false }) {
  const absoluteRoot = resolve(root);
  const files = await collectSourceFiles(absoluteRoot);
  const missing = [];
  const updated = [];

  for (const path of files) {
    const source = await readFile(path, "utf8");
    if (source.split("\n").slice(0, 3).includes(HEADER)) continue;
    const relativePath = normalizedRelative(absoluteRoot, path);
    if (write) {
      await writeFile(path, addHeader(source));
      updated.push(relativePath);
    } else {
      missing.push(relativePath);
    }
  }

  return {
    files: files.map((path) => normalizedRelative(absoluteRoot, path)),
    missing,
    updated,
  };
}

async function main() {
  const write = process.argv.includes("--write");
  const result = await checkSpdx({ root: repoRoot, write });

  if (result.missing.length > 0) {
    console.error(
      `Missing SPDX header in ${result.missing.length} source file(s):\n${result.missing.join("\n")}`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `${write ? "Applied" : "Verified"} SPDX headers for ${result.files.length} source files.`,
    );
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) await main();
