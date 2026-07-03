#!/usr/bin/env node
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "./init.js";
import { startWebServer } from "./server.js";
import { exportScreenToPng, resolveTarget } from "./export.js";
import { getScreen, parseProjectJson } from "@screenshot-studio/core/model";
import { readFile } from "node:fs/promises";

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

async function cmdInit(flags: Record<string, string>): Promise<void> {
  const cwd = flags.dir ? resolve(flags.dir) : process.cwd();
  await runInit(cwd, flags.name);
  console.log(`Initialized project in ${cwd}`);
}

async function cmdExport(flags: Record<string, string>): Promise<void> {
  const projectPath = resolve(flags.project ?? "app-store-screenshots.json");
  const storeSpecsPath = flags["store-specs"] ? resolve(flags["store-specs"]) : DEFAULT_STORE_SPECS;

  const project = parseProjectJson(await readFile(projectPath, "utf8"));
  const screenId = flags.screen ?? project.screens[0]!.id;
  const screen = getScreen(project, screenId);

  const target = await resolveTarget(
    storeSpecsPath,
    screen.platform,
    screen.device,
    flags.size ?? "6.9",
  );

  const server = await startWebServer();
  try {
    const png = await exportScreenToPng({
      baseUrl: server.url,
      projectPath,
      screenId,
      target,
    });
    const outDir = flags.out ? resolve(flags.out) : join(dirname(projectPath), "export");
    await mkdir(outDir, { recursive: true });
    const outFile = join(outDir, `${screen.platform}-${screen.device}-${target.id}-${screen.locale}.png`);
    await writeFile(outFile, png);
    console.log(`Exported ${outFile} (${target.width}×${target.height})`);
  } finally {
    await server.stop();
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  switch (command) {
    case "init":
      await cmdInit(flags);
      break;
    case "export":
      await cmdExport(flags);
      break;
    default:
      console.error(`Unknown command: ${command ?? "(none)"}\nUsage: screenshots <init|export> [flags]`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
