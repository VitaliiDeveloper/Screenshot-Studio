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
  "SECURITY.md",
  "docs/releasing.md",
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
assertIncludes(readme, "https://github.com/VitaliiDeveloper/Screenshot-Studio.git", "README source install");
assertIncludes(readme, "it is not a registry release", "README release status");
assertIncludes(readme, "A code-first, open-source editor", "README product positioning");
assertIncludes(readme, "Microsoft Store", "README Microsoft Store support");
assertIncludes(readme, "## Current capabilities", "README current capabilities");
assertIncludes(readme, "strict schema v1", "README current schema status");
assertIncludes(readme, "--store-specs <path>", "README store-spec override");
assertIncludes(readme, "persisted `storeTargetId`", "README single-target precedence");
assertIncludes(readme, "explicit persisted variants", "README bundle variant behavior");
assertIncludes(readme, "screen rm <id> --cascade", "README screen cascade behavior");
for (const legacyDoc of [
  "docs/roadmap.md",
  "docs/vision.md",
  "docs/release-readiness.md",
  "docs/phase9-closure.md",
]) {
  if (readme.includes(legacyDoc)) throw new Error(`README still links legacy documentation: ${legacyDoc}`);
}
assertIncludes(readme, "screenshot-studio-cli-0.1.0.tgz", "README candidate artifact");

const examplesReadme = await readFile(join(repoRoot, "examples/README.md"), "utf8");
for (const obsoleteTerm of ["v6 documents", "Phase 7"]) {
  if (examplesReadme.includes(obsoleteTerm)) {
    throw new Error(`Examples README still contains obsolete terminology: ${obsoleteTerm}`);
  }
}

for (const path of [
  "README.md",
  "AGENTS.md",
  "RULES.md",
  "docs/architecture.md",
  "docs/editor.md",
  "docs/testing.md",
  "docs/releasing.md",
]) {
  const source = await readFile(join(repoRoot, path), "utf8");
  if (/\b(?:post-)?phase\s+\d/i.test(source)) {
    throw new Error(`Current contract documentation still uses a numbered phase model: ${path}`);
  }
}

const security = await readFile(join(repoRoot, "SECURITY.md"), "utf8");
assertIncludes(security, "security/advisories/new", "private vulnerability reporting");
assertIncludes(security, "Current `main` branch", "current supported security surface");

const releasing = await readFile(join(repoRoot, "docs/releasing.md"), "utf8");
assertIncludes(releasing, "requires explicit owner authorization", "release authorization boundary");
assertIncludes(releasing, "screenshot-studio-cli-0.1.0.tgz", "release candidate artifact");
assertIncludes(releasing, "--pack-destination ../../../artifacts", "release artifact destination");
assertIncludes(releasing, "SHA-512 SRI", "release integrity algorithm");
assertIncludes(
  releasing,
  "npm publish ./artifacts/screenshot-studio-cli-0.1.0.tgz --access public --dry-run --json",
  "release exact-artifact integrity dry run",
);

const cliReadme = await readFile(join(repoRoot, "packages/cli/README.md"), "utf8");
assertIncludes(cliReadme, "Microsoft Store", "CLI README Microsoft Store support");
assertIncludes(cliReadme, "--store-specs <path>", "CLI README store-spec override");

const skill = await readFile(join(repoRoot, "skills/screenshot-studio/SKILL.md"), "utf8");
assertIncludes(skill, "Microsoft Store", "skill Microsoft Store support");

const notice = await readFile(join(repoRoot, "NOTICE"), "utf8");
assertIncludes(notice, "Copyright 2026 Vitalii Lavreniuk", "NOTICE copyright");
assertIncludes(notice, "Apache License, Version 2.0", "NOTICE license");

const schemaSource = await readFile(join(repoRoot, "packages/core/src/model/schema.ts"), "utf8");
const schemaVersionMatch = schemaSource.match(/export const SCHEMA_VERSION = (\d+);/);
if (!schemaVersionMatch) throw new Error("Cannot resolve the enforced schema version");
const currentSchemaVersion = Number(schemaVersionMatch[1]);

for (const path of [
  "examples/connected-launch/app-store-screenshots.json",
  "examples/rtl-delivery/app-store-screenshots.json",
]) {
  const project = JSON.parse(await readFile(join(repoRoot, path), "utf8"));
  if (project.meta?.schemaVersion !== currentSchemaVersion) {
    throw new Error(`Example is not authored as v${currentSchemaVersion}: ${path}`);
  }
}

console.log(`Verified ${requiredFiles.length} community surfaces and public status statements.`);
process.exitCode = 0;
