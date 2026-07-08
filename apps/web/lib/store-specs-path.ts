import { resolve } from "node:path";

/**
 * Resolves the on-disk store-specs.json — the one runtime source of export dimensions
 * (docs/architecture.md §4). Like project-path.ts, it resolves against INIT_CWD (repo root)
 * because `next dev` runs with cwd = apps/web. Server-only (uses node:path).
 */
export function resolveStoreSpecsPath(): string {
  const base = process.env.INIT_CWD ?? process.cwd();
  return resolve(base, process.env.STORE_SPECS_PATH ?? "store-specs.json");
}
