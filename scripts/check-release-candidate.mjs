// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPaths = [
  "package.json",
  "packages/core/package.json",
  "packages/cli/package.json",
  "apps/web/package.json",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(path) {
  return JSON.parse(await readFile(join(repoRoot, path), "utf8"));
}

const manifests = await Promise.all(manifestPaths.map(readJson));
const rootManifest = manifests[0];
const cliManifest = manifests[2];
const version = rootManifest.version;
assert(/^\d+\.\d+\.\d+$/.test(version) && version !== "0.0.0", `Invalid candidate version ${version}`);
for (const [index, manifest] of manifests.entries()) {
  assert(manifest.version === version, `${manifestPaths[index]} version differs from ${version}`);
  assert(manifest.private === true, `${manifestPaths[index]} must remain a private workspace package`);
}

const expectedRepository = "git+https://github.com/VitaliiDeveloper/Screenshot-Studio.git";
assert(cliManifest.repository?.url === expectedRepository, "CLI repository metadata drifted");
assert(cliManifest.repository?.directory === "packages/cli", "CLI repository directory drifted");
assert(cliManifest.homepage === "https://github.com/VitaliiDeveloper/Screenshot-Studio#readme", "CLI homepage drifted");
assert(cliManifest.bugs?.url === "https://github.com/VitaliiDeveloper/Screenshot-Studio/issues", "CLI bugs URL drifted");
assert(cliManifest.publishConfig?.access === "public", "CLI public-scope metadata drifted");
assert(Array.isArray(cliManifest.keywords) && cliManifest.keywords.length >= 5, "CLI keywords are incomplete");
for (const [name, dependency] of Object.entries({
  playwright: cliManifest.dependencies?.playwright,
  sharp: cliManifest.dependencies?.sharp,
})) {
  assert(/^\d+\.\d+\.\d+$/.test(dependency), `${name} must be pinned in the candidate`);
}

const packedManifest = await readJson("packages/cli/package/package.json");
assert(packedManifest.name === "@screenshot-studio/cli", "Packed package name drifted");
assert(packedManifest.version === version, "Packed version differs from workspace candidate");
assert(packedManifest.private === undefined, "Packed candidate must not inherit workspace private metadata");
for (const field of ["description", "repository", "homepage", "bugs", "keywords", "publishConfig"]) {
  assert(JSON.stringify(packedManifest[field]) === JSON.stringify(cliManifest[field]), `Packed ${field} drifted`);
}

const archiveName = `screenshot-studio-cli-${version}.tgz`;
const documents = {
  "README.md": await readFile(join(repoRoot, "README.md"), "utf8"),
  "SECURITY.md": await readFile(join(repoRoot, "SECURITY.md"), "utf8"),
  "docs/releasing.md": await readFile(join(repoRoot, "docs/releasing.md"), "utf8"),
};
assert(documents["README.md"].includes(archiveName), "README candidate filename drifted");
assert(documents["SECURITY.md"].includes("| Current `main` branch | Yes |"), "Security support table drifted");
assert(documents["docs/releasing.md"].includes(archiveName), "Release guide candidate filename drifted");
assert(documents["docs/releasing.md"].includes("requires explicit owner authorization"), "Release authorization boundary is missing");

process.stdout.write(`Verified release candidate ${version}, package metadata, pinned runtime dependencies, and public docs.\n`);
