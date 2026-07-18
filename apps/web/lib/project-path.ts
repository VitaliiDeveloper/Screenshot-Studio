// SPDX-License-Identifier: Apache-2.0
import { resolve } from "node:path";

const DEFAULT_PROJECT = "fixtures/sample/app-store-screenshots.json";

/**
 * Resolves the on-disk project JSON the editor reads and writes. Same local-file, self-hosted
 * model as the /render route: the path comes from PROJECT_PATH (env), defaulting to the
 * repo's bundled sample so the editor is runnable out of the box. Server-only (uses node:path).
 *
 * `next dev` runs with cwd = apps/web, so a relative PROJECT_PATH (or the default) must not
 * resolve against cwd — it resolves against INIT_CWD (set by pnpm/npm to the directory the
 * user invoked the command from, i.e. the repo root per the README). Absolute paths are
 * unaffected.
 */
function invocationBase(): string {
  return process.env.INIT_CWD ?? process.cwd();
}

/** Resolves only an explicit PROJECT_PATH; local session selection must not infer the sample. */
export function resolveConfiguredProjectPath(): string | null {
  const configured = process.env.PROJECT_PATH?.trim();
  return configured ? resolve(invocationBase(), configured) : null;
}

/** Retained for legacy/headless callers that need the bundled sample fallback. */
export function resolveProjectPath(): string {
  return resolveConfiguredProjectPath() ?? resolve(invocationBase(), DEFAULT_PROJECT);
}
