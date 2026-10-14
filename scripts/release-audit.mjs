// SPDX-License-Identifier: Apache-2.0
import { execFile as execFileCallback } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import JSZip from "jszip";
import { isPortableRenderHostPath, PACKAGE_LINKS_MANIFEST } from "./package-archive.mjs";
import { pnpmCommand } from "./pnpm-command.mjs";

const execFile = promisify(execFileCallback);
const modulePath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(modulePath), "..");
const stagedPackage = join(repoRoot, "packages", "cli", "package");
const MAX_PACKED_BYTES = 64 * 1024 * 1024;
const MAX_WEB_ARCHIVE_BYTES = 96 * 1024 * 1024;

export const EXPECTED_PACK_FILES = [
  "dist/index.js",
  "dist/index.js.map",
  "dist/project-agent-guide.md",
  "LICENSE",
  "NOTICE",
  "package.json",
  "README.md",
  "runtime/store-specs.json",
  "runtime/web.zip",
  "THIRD_PARTY_NOTICES.md",
];

export const ALLOWED_LICENSES = new Set([
  "0BSD",
  "(MIT AND Apache-2.0)",
  "(MIT AND Zlib)",
  "(MIT OR GPL-3.0-or-later)",
  "Apache-2.0",
  "BSD-3-Clause",
  "CC-BY-4.0",
  "ISC",
  "LGPL-3.0-or-later",
  "MIT",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function validatePackFiles(files) {
  const actual = [...files].sort();
  const expected = [...EXPECTED_PACK_FILES].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), `Unexpected package files: ${actual.join(", ")}`);
}

export function isForbiddenRuntimeEntry(path) {
  return !isPortableRenderHostPath(path)
    || /(?:^|\/)(?:[^/]+\.(?:node|dylib|dll|so(?:\.\d+)*))$/i.test(path)
    || /(?:darwin|linuxmusl|linux|win32)-(?:arm64|arm|x64|ia32|ppc64|riscv64|s390x)/i.test(path);
}

function packageRootFromSource(sourceMapPath, source) {
  if (!source.includes("node_modules/.pnpm/")) return undefined;
  const absolute = resolve(dirname(sourceMapPath), source);
  const marker = `${sep}node_modules${sep}`;
  const index = absolute.lastIndexOf(marker);
  if (index < 0) return undefined;
  const parts = absolute.slice(index + marker.length).split(sep);
  const packageName = parts[0]?.startsWith("@") ? parts.slice(0, 2).join(sep) : parts[0];
  return packageName ? absolute.slice(0, index + marker.length) + packageName : undefined;
}

function licenseNames(files) {
  return files.filter((name) => /^(?:license|copying|notice)(?:\.|$)/i.test(name)).sort();
}

const REVIEWED_IDENTIFIER_ONLY_MIT_PACKAGES = new Map([
  ["dfa@1.2.0", "Devon Govett <devongovett@gmail.com>"],
  ["fontkit@2.0.4", "Devon Govett <devongovett@gmail.com>"],
]);
const BROTLI_1_3_3_AUTHOR = "Devon Govett <devongovett@gmail.com>";
const BROTLI_APACHE_NOTICE = `/* Copyright 2013 Google Inc. All Rights Reserved.

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/`;
const MIT_PERMISSION_TERMS = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

function readmeLicenseSection(readme) {
  const heading = "## License";
  const index = readme.indexOf(heading);
  return index < 0 ? undefined : readme.slice(index + heading.length).trim();
}

export function reviewedPackageLicense(manifest) {
  return manifest.name === "brotli" && manifest.version === "1.3.3"
    ? "(MIT AND Apache-2.0)"
    : manifest.license;
}

export async function licenseTexts(packageRoot, manifest) {
  const files = await readdir(packageRoot);
  const names = licenseNames(files);
  if (names.length > 0) {
    return Promise.all(names.map(async (name) => `${name}\n\n${await readFile(join(packageRoot, name), "utf8")}`));
  }
  if (manifest.name === "isarray") {
    const readme = await readFile(join(packageRoot, "README.md"), "utf8");
    const license = readmeLicenseSection(readme);
    assert(license, `Missing README license section for ${manifest.name}@${manifest.version}`);
    return [`README.md license section\n\n${license}`];
  }
  if (manifest.name === "brotli" && manifest.version === "1.3.3") {
    const readmeName = files.find((name) => /^readme(?:\.|$)/i.test(name));
    assert(readmeName, "Missing README license declaration for brotli@1.3.3");
    const readme = await readFile(join(packageRoot, readmeName), "utf8");
    assert(readmeLicenseSection(readme) === "MIT", "brotli@1.3.3 README license declaration drifted");
    assert(manifest.license === "MIT", "brotli@1.3.3 package license metadata drifted");
    assert(manifest.author === BROTLI_1_3_3_AUTHOR, "brotli@1.3.3 package author metadata drifted");
    const decoderSource = await readFile(join(packageRoot, "dec", "decode.js"), "utf8");
    assert(decoderSource.startsWith(BROTLI_APACHE_NOTICE), "brotli@1.3.3 Apache source notice drifted");
    const apacheLicense = await readFile(join(repoRoot, "LICENSE"), "utf8");
    assert(
      apacheLicense.includes("Apache License") && apacheLicense.includes("Version 2.0, January 2004"),
      "Repository Apache-2.0 license text drifted",
    );
    return [
      `${readmeName} license declaration: MIT\n\nMIT License\n\nCopyright (c) ${BROTLI_1_3_3_AUTHOR}\n\n${MIT_PERMISSION_TERMS}`,
      `dec/decode.js source notice\n\n${BROTLI_APACHE_NOTICE}\n\nFull Apache-2.0 terms\n\n${apacheLicense}`,
    ];
  }
  // These exact package versions deliberately publish only the SPDX identifier in their READMEs.
  // Keep each fallback version/author pinned, then supply the full standard MIT terms required by
  // that declaration instead of weakening the audit for every package without a license file.
  const packageKey = `${manifest.name}@${manifest.version}`;
  const reviewedAuthor = REVIEWED_IDENTIFIER_ONLY_MIT_PACKAGES.get(packageKey);
  if (reviewedAuthor) {
    const readmeName = files.find((name) => /^readme(?:\.|$)/i.test(name));
    assert(readmeName, `Missing README license declaration for ${packageKey}`);
    const readme = await readFile(join(packageRoot, readmeName), "utf8");
    const license = readmeLicenseSection(readme);
    assert(license === "MIT", `${packageKey} README license declaration drifted`);
    assert(manifest.license === "MIT", `${packageKey} package license metadata drifted`);
    assert(manifest.author === reviewedAuthor, `${packageKey} package author metadata drifted`);
    return [
      `${readmeName} license declaration: MIT\n\nMIT License\n\nCopyright (c) ${reviewedAuthor}\n\n${MIT_PERMISSION_TERMS}`,
    ];
  }
  const fallback = manifest.name === "@next/env" ? "next" : manifest.name === "client-only" ? "react" : undefined;
  if (fallback) {
    const fallbackManifest = createRequire(join(repoRoot, "apps", "web", "package.json"))
      .resolve(`${fallback}/package.json`);
    return licenseTexts(dirname(fallbackManifest), JSON.parse(await readFile(fallbackManifest, "utf8")));
  }
  throw new Error(`Missing license text for embedded package ${manifest.name}@${manifest.version}`);
}

async function packageRecord(packageRoot) {
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  assert(manifest.name && manifest.version && manifest.license, `Incomplete package metadata at ${packageRoot}`);
  assert(ALLOWED_LICENSES.has(manifest.license), `Unreviewed license ${manifest.license} for ${manifest.name}`);
  const license = reviewedPackageLicense(manifest);
  assert(ALLOWED_LICENSES.has(license), `Unreviewed effective license ${license} for ${manifest.name}`);
  return {
    key: `${manifest.name}@${manifest.version}`,
    name: manifest.name,
    version: manifest.version,
    license,
    source: typeof manifest.repository === "string"
      ? manifest.repository
      : manifest.repository?.url ?? manifest.homepage ?? "package metadata",
    texts: await licenseTexts(packageRoot, manifest),
  };
}

async function embeddedPackageRecords(sourceMapPath, webArchivePath) {
  const records = new Map();
  const sourceMap = JSON.parse(await readFile(sourceMapPath, "utf8"));
  for (const source of sourceMap.sources) {
    const packageRoot = packageRootFromSource(sourceMapPath, source);
    if (!packageRoot) continue;
    const record = await packageRecord(packageRoot);
    records.set(record.key, record);
  }

  const archive = await JSZip.loadAsync(await readFile(webArchivePath));
  for (const [path, entry] of Object.entries(archive.files)) {
    if (
      !path.endsWith("package.json")
      || !path.includes("node_modules/.pnpm/")
      || path.includes("/node_modules/next/dist/compiled/")
    ) continue;
    const manifest = JSON.parse(await entry.async("string"));
    if (!manifest.name || !manifest.version) continue;
    const record = await packageRecord(dirname(join(repoRoot, path)));
    records.set(record.key, record);
  }
  return [...records.values()].sort((first, second) => first.key.localeCompare(second.key));
}

export async function generateThirdPartyNotices({ sourceMapPath, webArchivePath, outputPath }) {
  const records = await embeddedPackageRecords(sourceMapPath, webArchivePath);
  const sections = records.map((record) => [
    `## ${record.key}`,
    "",
    `License: ${record.license}`,
    `Source: ${record.source}`,
    "",
    ...record.texts.flatMap((text) => text.split("\n").map((line) => `    ${line}`)),
  ].join("\n"));
  const content = [
    "# Third-party notices",
    "",
    "Generated from the production CLI source map and embedded standalone web runtime.",
    "Next.js dist/compiled internals are covered by the recorded Next.js distribution license.",
    "Runtime-installed external dependencies retain their own package license files.",
    "",
    ...sections,
    "",
  ].join("\n");
  await writeFile(outputPath, content);
  return records.map(({ key, license }) => ({ key, license }));
}

async function externalRuntimeRecords(manifest) {
  const packageManifest = join(repoRoot, "packages", "cli", "package.json");
  const pending = Object.keys(manifest.dependencies ?? {}).map((name) => ({ name, from: packageManifest }));
  const records = new Map();
  while (pending.length > 0) {
    const candidate = pending.shift();
    const name = candidate?.name;
    if (!name || records.has(name)) continue;
    let manifestPath;
    try {
      const require = createRequire(candidate.from);
      try {
        manifestPath = require.resolve(`${name}/package.json`);
      } catch (error) {
        if (error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED" && error.code !== "MODULE_NOT_FOUND") throw error;
        let cursor = dirname(candidate.from);
        while (true) {
          for (const base of [cursor, join(cursor, "node_modules")]) {
            const path = join(base, ...name.split("/"), "package.json");
            try {
              const resolvedManifest = JSON.parse(await readFile(path, "utf8"));
              if (resolvedManifest.name === name) {
                manifestPath = path;
                break;
              }
            } catch {
              // Continue to the package root.
            }
          }
          if (manifestPath) break;
          const parent = resolve(cursor, "..");
          if (parent === cursor) break;
          cursor = parent;
        }
        if (!manifestPath) throw error;
      }
      manifestPath = await realpath(manifestPath);
    } catch {
      continue;
    }
    const dependency = JSON.parse(await readFile(manifestPath, "utf8"));
    assert(dependency.license && ALLOWED_LICENSES.has(dependency.license), `Unreviewed external license for ${name}`);
    records.set(name, { key: `${dependency.name}@${dependency.version}`, license: dependency.license });
    pending.push(
      ...Object.keys(dependency.dependencies ?? {}).map((dependencyName) => ({ name: dependencyName, from: manifestPath })),
      ...Object.keys(dependency.optionalDependencies ?? {}).map((dependencyName) => ({ name: dependencyName, from: manifestPath })),
    );
  }
  return [...records.values()].sort((first, second) => first.key.localeCompare(second.key));
}

async function runPack(destination) {
  const args = ["--dir", stagedPackage, "pack", "--json", "--pack-destination", destination];
  const [command, commandArgs] = pnpmCommand(args);
  const result = await execFile(command, commandArgs, { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(result.stdout);
}

export async function auditReleasePackage() {
  const directory = await mkdtemp(join(tmpdir(), "screenshot-studio-release-audit-"));
  try {
    const details = await runPack(directory);
    const files = details.files.map((file) => file.path);
    validatePackFiles(files);
    const packedBytes = (await stat(details.filename)).size;
    assert(packedBytes < MAX_PACKED_BYTES, `Packed artifact exceeds 64 MiB: ${packedBytes}`);

    const manifest = JSON.parse(await readFile(join(stagedPackage, "package.json"), "utf8"));
    assert(manifest.engines?.node === ">=22.13", "Packed Node engine drifted");
    assert(JSON.stringify(Object.keys(manifest.dependencies ?? {}).sort()) === JSON.stringify(["playwright", "sharp"]), "Packed dependencies drifted");

    const webArchivePath = join(stagedPackage, "runtime", "web.zip");
    const webArchiveBytes = (await stat(webArchivePath)).size;
    assert(webArchiveBytes < MAX_WEB_ARCHIVE_BYTES, `Web archive exceeds 96 MiB: ${webArchiveBytes}`);
    const archive = await JSZip.loadAsync(await readFile(webArchivePath));
    const archiveFiles = Object.keys(archive.files);
    for (const required of [PACKAGE_LINKS_MANIFEST, "apps/web/server.js", "apps/web/.next/BUILD_ID"]) {
      assert(archiveFiles.includes(required), `Web archive is missing ${required}`);
    }
    assert(archiveFiles.some((path) => path.startsWith("apps/web/.next/static/")), "Web archive is missing static assets");
    const forbidden = archiveFiles.filter(isForbiddenRuntimeEntry);
    assert(forbidden.length === 0, `Web archive contains platform-native entries: ${forbidden.join(", ")}`);

    const embedded = await embeddedPackageRecords(
      join(stagedPackage, "dist", "index.js.map"),
      webArchivePath,
    );
    const notices = await readFile(join(stagedPackage, "THIRD_PARTY_NOTICES.md"), "utf8");
    for (const record of embedded) {
      assert(notices.includes(`## ${record.key}`), `Third-party notices omit ${record.key}`);
      assert(notices.includes(`License: ${record.license}`), `Third-party notices omit ${record.license}`);
    }

    return {
      packedBytes,
      webArchiveBytes,
      files,
      directDependencies: manifest.dependencies,
      embeddedPackages: embedded.map(({ key, license }) => ({ key, license })),
      externalPackages: await externalRuntimeRecords(manifest),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  process.stdout.write(`${JSON.stringify(await auditReleasePackage(), null, 2)}\n`);
}
