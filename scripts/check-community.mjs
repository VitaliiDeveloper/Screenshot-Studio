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
  "CHANGELOG.md",
  "SECURITY.md",
  "docs/releasing.md",
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
assertIncludes(readme, "Phase 6 and Phase 7 complete the planned baseline", "README baseline status");
assertIncludes(
  readme,
  "Phase 8 (stabilization + release readiness) — done; decision: `GO`.",
  "README Phase 8 status",
);
if (readme.includes("Phase 8 stabilization/release readiness is now\nin progress")) {
  throw new Error("README still reports Phase 8 as in progress");
}
assertIncludes(readme, "screenshot-studio-cli-0.1.0.tgz", "README candidate artifact");

const changelog = await readFile(join(repoRoot, "CHANGELOG.md"), "utf8");
assertIncludes(changelog, "## [0.1.0] - 2026-07-11 (release candidate)", "candidate changelog");

const security = await readFile(join(repoRoot, "SECURITY.md"), "utf8");
assertIncludes(security, "security/advisories/new", "private vulnerability reporting");

const releasing = await readFile(join(repoRoot, "docs/releasing.md"), "utf8");
assertIncludes(releasing, "requires explicit owner authorization", "release authorization boundary");
assertIncludes(releasing, "screenshot-studio-cli-0.1.0.tgz", "release candidate artifact");

const notice = await readFile(join(repoRoot, "NOTICE"), "utf8");
assertIncludes(notice, "Copyright 2026 Vitalii Lavreniuk", "NOTICE copyright");
assertIncludes(notice, "Apache License, Version 2.0", "NOTICE license");

for (const path of [
  "examples/connected-launch/app-store-screenshots.json",
  "examples/rtl-delivery/app-store-screenshots.json",
]) {
  const project = JSON.parse(await readFile(join(repoRoot, path), "utf8"));
  if (project.meta?.schemaVersion !== 5) throw new Error(`Example is not authored as v5: ${path}`);
}

console.log(`Verified ${requiredFiles.length} community surfaces and public status statements.`);
process.exitCode = 0;
