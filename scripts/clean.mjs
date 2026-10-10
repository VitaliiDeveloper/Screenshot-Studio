// SPDX-License-Identifier: Apache-2.0
import console from "node:console";
import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const CLEAN_PATHS = [
  ".cache",
  ".eslintcache",
  ".playwright",
  ".pnpm-store",
  ".turbo",
  ".vitest",
  "apps/web/.next",
  "apps/web/tsconfig.tsbuildinfo",
  "blob-report",
  "build",
  "coverage",
  "dist",
  "e2e/.tmp",
  "out",
  "packages/cli/dist",
  "packages/cli/package",
  "packages/core/dist",
  "playwright-report",
  "test-results",
];

export async function clean(root) {
  await Promise.all(CLEAN_PATHS.map((path) => rm(join(root, path), {
    force: true,
    recursive: true,
  })));
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  await clean(resolve(dirname(scriptPath), ".."));
  console.log("Cleaned Screenshot Studio build and test caches.");
}
