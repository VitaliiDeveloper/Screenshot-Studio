// SPDX-License-Identifier: Apache-2.0
import { join, resolve } from "node:path";

const DEFAULT_MAX_PROJECT_FILES = 10_000;
const DEFAULT_MAX_PROJECT_BYTES = 1_073_741_824;
const DEFAULT_MAX_IMPORT_UPLOAD_BYTES = 268_435_456;
const DEFAULT_STAGING_TTL_MS = 86_400_000;

export interface ManagedProjectStorageConfig {
  root: string;
  projectsRoot: string;
  stagingRoot: string;
  recoveryRoot: string;
  catalogPath: string;
  maxProjectFiles: number;
  maxProjectBytes: number;
  maxImportUploadBytes: number;
  stagingTtlMs: number;
}

function positiveInteger(
  environment: NodeJS.ProcessEnv,
  name: "SCREENSHOT_STUDIO_MAX_PROJECT_FILES" | "SCREENSHOT_STUDIO_MAX_PROJECT_BYTES" | "SCREENSHOT_STUDIO_MAX_IMPORT_UPLOAD_BYTES" | "SCREENSHOT_STUDIO_STAGING_TTL_MS",
  fallback: number,
): number {
  const value = environment[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return parsed;
}

export function resolveManagedProjectStorageConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ManagedProjectStorageConfig {
  const invocationDirectory = environment.INIT_CWD ?? process.cwd();
  const root = resolve(invocationDirectory, environment.SCREENSHOT_STUDIO_DATA_ROOT ?? ".screenshot-studio");
  return {
    root,
    projectsRoot: join(root, "projects"),
    stagingRoot: join(root, "staging"),
    recoveryRoot: join(root, "recovery"),
    catalogPath: join(root, "catalog.json"),
    maxProjectFiles: positiveInteger(
      environment,
      "SCREENSHOT_STUDIO_MAX_PROJECT_FILES",
      DEFAULT_MAX_PROJECT_FILES,
    ),
    maxProjectBytes: positiveInteger(
      environment,
      "SCREENSHOT_STUDIO_MAX_PROJECT_BYTES",
      DEFAULT_MAX_PROJECT_BYTES,
    ),
    maxImportUploadBytes: positiveInteger(
      environment,
      "SCREENSHOT_STUDIO_MAX_IMPORT_UPLOAD_BYTES",
      DEFAULT_MAX_IMPORT_UPLOAD_BYTES,
    ),
    stagingTtlMs: positiveInteger(
      environment,
      "SCREENSHOT_STUDIO_STAGING_TTL_MS",
      DEFAULT_STAGING_TTL_MS,
    ),
  };
}
