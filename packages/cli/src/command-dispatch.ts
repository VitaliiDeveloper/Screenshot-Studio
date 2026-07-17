// SPDX-License-Identifier: Apache-2.0
import { resolve } from "node:path";
import { runAssetCommand } from "./asset-commands.js";
import { COMMAND_FLAG_SPECS, isCliCommand, parseCommandFlags } from "./command-flags.js";
import { runDevCommand, runImportCommand } from "./dev-command.js";
import { runExportCommand } from "./export-command.js";
import { runFontCommand } from "./font-commands.js";
import { runInit } from "./init.js";
import { runLayoutCommand } from "./layout-commands.js";
import { runLocaleCommand } from "./locale-commands.js";
import { resolveProjectPath } from "./project-io.js";
import { runScreenCommand } from "./screen-commands.js";
import { runThemeCommand } from "./theme-commands.js";

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

async function runInitCommand(flags: Record<string, string>): Promise<void> {
  const cwd = flags.dir ? resolve(flags.dir) : process.cwd();
  await runInit(cwd, flags.name);
  console.log(`Initialized project in ${cwd}`);
}

async function runScreenManagementCommand(
  args: string[],
  flags: Record<string, string>,
  defaultStoreSpecsPath: string,
): Promise<void> {
  const projectPath = resolveProjectPath(flags);
  const storeSpecsPath = flags["store-specs"] ? resolve(flags["store-specs"]) : defaultStoreSpecsPath;
  const output = await runScreenCommand(projectPath, storeSpecsPath, args, flags);
  if (output) console.log(output);
}

async function runFontManagementCommand(args: string[], flags: Record<string, string>): Promise<void> {
  const output = await runFontCommand(resolveProjectPath(flags), args, flags);
  if (output) console.log(output);
}

export async function dispatchCommand(
  command: string | undefined,
  argv: string[],
  defaults: { storeSpecsPath: string },
): Promise<void> {
  if (!isCliCommand(command)) {
    throw new Error(`Unknown command: ${command ?? "(none)"}\nUsage: screenshots <init|export|screen|dev|import|font|theme|locale|asset|layout> [flags]`);
  }

  const { flags, args } = parseCommandFlags(argv, COMMAND_FLAG_SPECS[command]);
  switch (command) {
    case "init":
      await runInitCommand(flags);
      break;
    case "export":
      await runExportCommand(flags, defaults.storeSpecsPath);
      break;
    case "screen":
      await runScreenManagementCommand(args, flags, defaults.storeSpecsPath);
      break;
    case "dev":
      await runDevCommand(flags, defaults.storeSpecsPath);
      break;
    case "import":
      await runImportCommand(args, flags);
      break;
    case "font":
      await runFontManagementCommand(args, flags);
      break;
    case "theme":
      console.log(await runThemeCommand(resolveProjectPath(flags), args, flags));
      break;
    case "locale":
      console.log(await runLocaleCommand(resolveProjectPath(flags), args, flags));
      break;
    case "asset":
      console.log(await runAssetCommand(resolveProjectPath(flags), args, flags));
      break;
    case "layout":
      console.log(await runLayoutCommand(resolveProjectPath(flags), args, flags));
      break;
  }
}
