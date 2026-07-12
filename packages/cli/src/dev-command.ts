// SPDX-License-Identifier: Apache-2.0
import { resolve } from "node:path";
import { runWithCleanup } from "./cli-runtime.js";
import { importCaptures } from "./import-command.js";
import { resolveProjectPath } from "./project-io.js";
import { startWebServer } from "./server.js";

export interface DevOptions {
  projectPath: string;
  port?: number;
}

export function resolveDevOptions(flags: Record<string, string>): DevOptions {
  let port: number | undefined;
  if (flags.port) {
    port = Number(flags.port);
    if (!Number.isInteger(port) || port <= 0) throw new Error("--port must be a positive integer");
  }
  return { projectPath: resolveProjectPath(flags), port };
}

export interface ImportOptions {
  projectPath: string;
  inputDir: string;
}

export function resolveImportOptions(args: string[], flags: Record<string, string>): ImportOptions {
  const [inputDir] = args;
  if (!inputDir) throw new Error("Usage: screenshots import <dir>");
  return { projectPath: resolveProjectPath(flags), inputDir: resolve(inputDir) };
}

export async function runDevCommand(
  flags: Record<string, string>,
  defaultStoreSpecsPath: string,
): Promise<void> {
  const options = resolveDevOptions(flags);
  const storeSpecsPath = flags["store-specs"] ? resolve(flags["store-specs"]) : defaultStoreSpecsPath;
  const server = await startWebServer(options.port, { projectPath: options.projectPath, storeSpecsPath });
  console.log(`Editor running at ${server.url}/editor`);

  await runWithCleanup(() => Promise.race([
    new Promise<void>((resolveShutdown) => {
      const shutdown = () => resolveShutdown();
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    }),
    server.exited.then((error) => { throw error; }),
  ]), () => server.stop());
}

export async function runImportCommand(
  args: string[],
  flags: Record<string, string>,
): Promise<void> {
  const options = resolveImportOptions(args, flags);
  const result = await importCaptures(options);
  for (const warning of result.warnings) console.warn(warning);
  console.log(`Imported ${result.imported} screenshots`);
}
