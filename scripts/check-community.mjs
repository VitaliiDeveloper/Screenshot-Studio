// SPDX-License-Identifier: Apache-2.0
import console from "node:console";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "LICENSE",
  "NOTICE",
  "CONTRIBUTING.md",
  "docs/assets/editor-demo.gif",
  "examples/README.md",
  "examples/connected-launch/app-store-screenshots.json",
  "examples/rtl-delivery/app-store-screenshots.json",
  "skills/screenshot-studio/SKILL.md",
];

function assertIncludes(source, expected, label) {
  if (!source.includes(expected)) throw new Error(`${label} is missing: ${expected}`);
}

for (const path of requiredFiles) {
  const info = await stat(join(repoRoot, path));
  if (!info.isFile() || info.size === 0) throw new Error(`Required community file is empty: ${path}`);
}

const readme = await readFile(join(repoRoot, "README.md"), "utf8");
assertIncludes(readme, "docs/assets/editor-demo.gif", "README demo");
assertIncludes(readme, "https://github.com/VitaliiDeveloper/Screenshot-Studio.git", "README source install");
assertIncludes(readme, "it is not a registry release", "README release status");
assertIncludes(readme, "Phase 7 is next and completes the baseline", "README baseline status");

const notice = await readFile(join(repoRoot, "NOTICE"), "utf8");
assertIncludes(notice, "Copyright 2026 Vitalii Lavreniuk", "NOTICE copyright");
assertIncludes(notice, "Apache License, Version 2.0", "NOTICE license");

for (const path of [
  "examples/connected-launch/app-store-screenshots.json",
  "examples/rtl-delivery/app-store-screenshots.json",
]) {
  const project = JSON.parse(await readFile(join(repoRoot, path), "utf8"));
  if (project.meta?.schemaVersion !== 2) throw new Error(`Example is not authored as v2: ${path}`);
}

console.log(`Verified ${requiredFiles.length} community surfaces and public status statements.`);
process.exitCode = 0;
