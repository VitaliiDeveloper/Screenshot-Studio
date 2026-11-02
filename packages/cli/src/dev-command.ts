// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseStoreSpecs } from "@screenshot-studio/core/export";
import { runWithCleanup } from "./cli-runtime.js";
import { importCaptures } from "./import-command.js";
import { resolveProjectPath } from "./project-io.js";
import { startWebServer, type RunningServer } from "./server.js";

export interface DevOptions {
  projectPath: string;
  port?: number;
}

export function parsePortFlag(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const port = /^\d+$/.test(value) ? Number(value) : 0;
  if (port < 1 || port > 65535) throw new Error("--port must be a whole number from 1 to 65535");
  return port;
}

export function resolveDevOptions(flags: Record<string, string>): DevOptions {
  return { projectPath: resolveProjectPath(flags), port: parsePortFlag(flags.port) };
}

/** Keeps the host running until Ctrl+C or SIGTERM, and fails if it exits on its own. */
export async function serveUntilStopped(server: RunningServer): Promise<void> {
  await runWithCleanup(() => Promise.race([
    new Promise<void>((resolveShutdown) => {
      const shutdown = () => resolveShutdown();
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    }),
    server.exited.then((error) => { throw error; }),
  ]), () => server.stop());
}

export interface ImportOptions {
  projectPath: string;
  inputDir: string;
  layout?: string;
  refresh?: boolean;
}

export function resolveImportOptions(args: string[], flags: Record<string, string>): ImportOptions {
  const [inputDir] = args;
  if (!inputDir) throw new Error("Usage: screenshots import <dir>");
  return {
    projectPath: resolveProjectPath(flags),
    inputDir: resolve(inputDir),
    ...(flags.layout ? { layout: flags.layout } : {}),
    ...(flags.refresh === "true" ? { refresh: true } : {}),
  };
}

export async function runDevCommand(
  flags: Record<string, string>,
  defaultStoreSpecsPath: string,
): Promise<void> {
  const options = resolveDevOptions(flags);
  const storeSpecsPath = flags["store-specs"] ? resolve(flags["store-specs"]) : defaultStoreSpecsPath;
  const server = await startWebServer(options.port, { projectPath: options.projectPath, storeSpecsPath });
  console.log(`Editor running at ${server.url}/editor`);
  await serveUntilStopped(server);
}

export async function runImportCommand(
  args: string[],
  flags: Record<string, string>,
  defaultStoreSpecsPath: string,
): Promise<void> {
  const options = resolveImportOptions(args, flags);
  const storeSpecsPath = flags["store-specs"] ? resolve(flags["store-specs"]) : defaultStoreSpecsPath;
  const storeSpecs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
  const result = await importCaptures(options, { storeSpecs });
  for (const warning of result.warnings) console.warn(warning);
  if (result.refresh) {
    const { captures, references, unchanged, unmatched } = result.refresh;
    console.log(`Refreshed ${captures} captures (${references} references), ${unchanged} unchanged, ${unmatched} unmatched`);
  } else {
    console.log(`Imported ${result.imported} screenshots`);
  }
}
