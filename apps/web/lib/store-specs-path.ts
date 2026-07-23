// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const STORE_SPECS_FILE = "store-specs.json";
const WORKSPACE_MARKER = "pnpm-workspace.yaml";

export interface ResolveStoreSpecsPathOptions {
  environment?: Partial<Pick<NodeJS.ProcessEnv, "INIT_CWD" | "STORE_SPECS_PATH">>;
  currentDirectory?: string;
  pathExists?: (path: string) => boolean;
}

function findDefaultStoreSpecsPath(
  start: string,
  pathExists: (path: string) => boolean,
): string {
  let directory = resolve(start);
  let workspaceRoot: string | null = null;
  while (true) {
    const candidate = join(directory, STORE_SPECS_FILE);
    if (pathExists(candidate)) return candidate;
    if (workspaceRoot === null && pathExists(join(directory, WORKSPACE_MARKER))) {
      workspaceRoot = directory;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return join(workspaceRoot ?? resolve(start), STORE_SPECS_FILE);
}

/**
 * Resolves the on-disk store-specs.json — the one runtime source of export dimensions
 * (docs/architecture.md). Explicit configuration resolves against INIT_CWD when available.
 * Without it, filtered package runners may erase INIT_CWD and change cwd to apps/web, so the
 * resolver walks upward to the nearest store specs file (or workspace root) instead of treating
 * the web package as the runtime root. Server-only (uses node:fs and node:path).
 */
export function resolveStoreSpecsPath(
  options: ResolveStoreSpecsPathOptions = {},
): string {
  const environment = options.environment ?? process.env;
  const base = environment.INIT_CWD?.trim() || options.currentDirectory || process.cwd();
  const configured = environment.STORE_SPECS_PATH?.trim();
  if (configured) return resolve(base, configured);
  return findDefaultStoreSpecsPath(base, options.pathExists ?? existsSync);
}
