import { resolve } from "node:path";

/**
 * Resolves the on-disk project JSON the editor reads and writes. Same local-file, self-hosted
 * model as the /render route: the path comes from PROJECT_PATH (env), defaulting to the
 * repo-relative sample so the editor is runnable out of the box. Server-only (uses node:path).
 */
export function resolveProjectPath(): string {
  return resolve(process.env.PROJECT_PATH ?? "fixtures/phase-0-sample/app-store-screenshots.json");
}
