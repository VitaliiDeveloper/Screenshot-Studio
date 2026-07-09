#!/usr/bin/env node
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInit } from "./init.js";
import { startWebServer } from "./server.js";
import { exportBundle, exportScreenToPng, resolveTarget } from "./export.js";
import { createRenderBrowserSession } from "./render-driver.js";
import { buildBundleEntries, parseStoreSpecs, type BundleFilters } from "@screenshot-studio/core/export";
import { assertProjectFontsResolved, getScreen, parseProjectJson } from "@screenshot-studio/core/model";
import { resolveProjectPath } from "./project-io.js";
import { runScreenCommand } from "./screen-commands.js";
import { importCaptures } from "./import-command.js";
import { runFontCommand } from "./font-commands.js";

/**
 * `screenshots` CLI — the Phase 0 surface is `init` and `export` only (docs/roadmap.md Phase 0).
 * `export` delegates all pixel rendering to the served web renderer (decision A), so its output
 * is the same as the future UI export button by construction.
 */

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const DEFAULT_STORE_SPECS = join(repoRoot, "store-specs.json");

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  return flags;
}

export function positionalArgs(argv: string[]): string[] {
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) i++;
    } else {
      args.push(arg);
    }
  }
  return args;
}

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

export type ExportMode =
  | { kind: "single"; screenId: string; sizeId: string }
  | { kind: "bundle"; filters: BundleFilters };

export function resolveExportMode(flags: Record<string, string>): ExportMode {
  const hasBundleFilter = Boolean(flags.platform || flags.device || flags.locale);
  if (flags.screen && hasBundleFilter) {
    throw new Error("--screen cannot be combined with --platform, --device, or --locale");
  }
  if (flags.size && !flags.screen) {
    throw new Error("--size requires --screen; bundle exports use each device's lead size");
  }
  if (flags.screen) {
    return { kind: "single", screenId: flags.screen, sizeId: flags.size ?? "6.9" };
  }
  return {
    kind: "bundle",
    filters: {
      platform: flags.platform as BundleFilters["platform"],
      device: flags.device as BundleFilters["device"],
      locale: flags.locale,
    },
  };
}

async function cmdInit(flags: Record<string, string>): Promise<void> {
  const cwd = flags.dir ? resolve(flags.dir) : process.cwd();
  await runInit(cwd, flags.name);
  console.log(`Initialized project in ${cwd}`);
}

async function cmdExport(flags: Record<string, string>): Promise<void> {
  const projectPath = resolve(flags.project ?? "app-store-screenshots.json");
  const storeSpecsPath = flags["store-specs"] ? resolve(flags["store-specs"]) : DEFAULT_STORE_SPECS;
  const outDir = flags.out ? resolve(flags.out) : join(dirname(projectPath), "export");
  const mode = resolveExportMode(flags);

  const project = parseProjectJson(await readFile(projectPath, "utf8"));
  assertProjectFontsResolved(project);

  if (mode.kind === "single") {
    const screen = getScreen(project, mode.screenId);
    const target = await resolveTarget(
      storeSpecsPath,
      screen.platform,
      screen.device,
      mode.sizeId,
    );

    const server = await startWebServer();
    try {
      const png = await exportScreenToPng({
        baseUrl: server.url,
        projectPath,
        screenId: mode.screenId,
        target,
      });
      await mkdir(outDir, { recursive: true });
      const outFile = join(outDir, `${screen.platform}-${screen.device}-${target.id}-${screen.locale}.png`);
      await writeFile(outFile, png);
      console.log(`Exported ${outFile} (${target.width}x${target.height})`);
    } finally {
      await server.stop();
    }
    return;
  }

  const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
  const entries = buildBundleEntries(project, specs, mode.filters);
  const server = await startWebServer();
  const session = await createRenderBrowserSession();
  try {
    const zipPath = await exportBundle({
      baseUrl: server.url,
      projectPath,
      outDir,
      entries,
      renderSession: session,
    });
    console.log(`Exported ${entries.length} screenshots to ${outDir}`);
    console.log(`Wrote bundle ${zipPath}`);
  } finally {
    await session.close();
    await server.stop();
  }
}

async function cmdScreen(args: string[], flags: Record<string, string>): Promise<void> {
  const projectPath = resolveProjectPath(flags);
  const storeSpecsPath = flags["store-specs"] ? resolve(flags["store-specs"]) : DEFAULT_STORE_SPECS;
  const output = await runScreenCommand(projectPath, storeSpecsPath, args, flags);
  if (output) console.log(output);
}

async function cmdDev(flags: Record<string, string>): Promise<void> {
  const options = resolveDevOptions(flags);
  const server = await startWebServer(options.port, { projectPath: options.projectPath });
  console.log(`Editor running at ${server.url}/editor`);

  await new Promise<void>((resolveShutdown) => {
    const shutdown = async () => {
      await server.stop();
      resolveShutdown();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

async function cmdImport(args: string[], flags: Record<string, string>): Promise<void> {
  const options = resolveImportOptions(args, flags);
  const result = await importCaptures(options);
  for (const warning of result.warnings) console.warn(warning);
  console.log(`Imported ${result.imported} screenshots`);
}

async function cmdFont(args: string[], flags: Record<string, string>): Promise<void> {
  const output = await runFontCommand(resolveProjectPath(flags), args, flags);
  if (output) console.log(output);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  const args = positionalArgs(rest);
  switch (command) {
    case "init":
      await cmdInit(flags);
      break;
    case "export":
      await cmdExport(flags);
      break;
    case "screen":
      await cmdScreen(args, flags);
      break;
    case "dev":
      await cmdDev(flags);
      break;
    case "import":
      await cmdImport(args, flags);
      break;
    case "font":
      await cmdFont(args, flags);
      break;
    default:
      console.error(`Unknown command: ${command ?? "(none)"}\nUsage: screenshots <init|export|screen|dev|import|font> [flags]`);
      process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
