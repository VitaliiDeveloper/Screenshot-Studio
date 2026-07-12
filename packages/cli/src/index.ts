#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dispatchCommand } from "./command-dispatch.js";

/**
 * `screenshots` CLI — project setup, export, deterministic asset processing, and the shipped
 * screen/locale/font/theme/canvas management surface.
 * `export` delegates all pixel rendering to the served web renderer (decision A), so its output
 * stays identical to UI export by construction.
 */

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packagedStoreSpecs = join(packageRoot, "runtime", "store-specs.json");
const sourceStoreSpecs = resolve(packageRoot, "../../store-specs.json");
const DEFAULT_STORE_SPECS = existsSync(packagedStoreSpecs) ? packagedStoreSpecs : sourceStoreSpecs;

export { positionalArgs } from "./command-dispatch.js";
export {
  resolveDevOptions,
  resolveImportOptions,
  type DevOptions,
  type ImportOptions,
} from "./dev-command.js";
export {
  resolveExportMode,
  singleExportFilename,
  singleExportTargetId,
  type ExportMode,
} from "./export-command.js";

const invokedPath = process.argv[1];
const invokedDirectly = invokedPath
  ? realpathSync(invokedPath) === realpathSync(fileURLToPath(import.meta.url))
  : false;

if (invokedDirectly) {
  const [command, ...argv] = process.argv.slice(2);
  dispatchCommand(command, argv, { storeSpecsPath: DEFAULT_STORE_SPECS }).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
