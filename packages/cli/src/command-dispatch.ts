// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseStoreSpecs } from "@screenshot-studio/core/export";
import { runAppStoreUploadCommand } from "./app-store-upload-command.js";
import { runAssetCommand } from "./asset-commands.js";
import { ensureRenderBrowsers, resolveBrowserChoice, runSetupCommand, type BrowserSetupDependencies } from "./browser-setup.js";
import { runCheckCommand } from "./check-command.js";
import { COMMAND_FLAG_SPECS, LAUNCH_FLAG_SPEC, isCliCommand, parseCommandFlags } from "./command-flags.js";
import { runCopyCommand } from "./copy-commands.js";
import { runDevCommand, runImportCommand } from "./dev-command.js";
import { runElementCommand } from "./element-commands.js";
import { runExportCommand } from "./export-command.js";
import { runFontCommand } from "./font-commands.js";
import { runInit } from "./init.js";
import { defaultLaunchDependencies, runLaunchCommand, type LaunchDependencies } from "./launch-command.js";
import { runLayoutCommand } from "./layout-commands.js";
import { runLocaleCommand } from "./locale-commands.js";
import { resolveProjectPath } from "./project-io.js";
import { runPublishingCommand } from "./publishing-commands.js";
import { runScreenCommand } from "./screen-commands.js";
import { runTemplateCommand } from "./template-commands.js";
import { runThemeCommand } from "./theme-commands.js";
import { runUploadCommand } from "./upload-command.js";

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

async function runInitCommand(flags: Record<string, string>, storeSpecsPath: string): Promise<void> {
  const cwd = flags.dir ? resolve(flags.dir) : process.cwd();
  const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
  await runInit(cwd, flags.name, specs);
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

const USAGE = [
  "Usage: screenshots [--port <port>] [--no-open]",
  "       screenshots <init|export|check|screen|dev|import|font|theme|locale|asset|layout|setup|template|element|copy|publishing|upload> [flags]",
].join("\n");

function launchFlags(argv: string[]): Record<string, string> {
  let parsed;
  try {
    parsed = parseCommandFlags(argv, LAUNCH_FLAG_SPEC);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`, { cause: error });
  }
  if (parsed.args.length > 0) throw new Error(`Unknown command: ${parsed.args[0]}\n${USAGE}`);
  return parsed.flags;
}

export async function dispatchCommand(
  command: string | undefined,
  argv: string[],
  defaults: { storeSpecsPath: string; browserSetup?: BrowserSetupDependencies; launch?: LaunchDependencies },
): Promise<void> {
  if (command === undefined || command.startsWith("--")) {
    const flags = launchFlags(command === undefined ? argv : [command, ...argv]);
    await runLaunchCommand(flags, defaults.launch ?? defaultLaunchDependencies(
      defaults.storeSpecsPath,
      () => ensureRenderBrowsers("optional", defaults.browserSetup),
    ));
    return;
  }
  if (!isCliCommand(command)) throw new Error(`Unknown command: ${command}\n${USAGE}`);

  const { flags, args } = parseCommandFlags(argv, COMMAND_FLAG_SPECS[command]);
  switch (command) {
    case "init":
      await runInitCommand(flags, defaults.storeSpecsPath);
      break;
    case "export":
      await ensureRenderBrowsers("required", defaults.browserSetup, resolveBrowserChoice(flags.browser));
      await runExportCommand(flags, defaults.storeSpecsPath);
      break;
    case "check": {
      if (flags.render) await ensureRenderBrowsers("required", defaults.browserSetup);
      const result = await runCheckCommand(flags, defaults.storeSpecsPath);
      console.log(result.output);
      // exitCode, not exit(): a large --json report piped to CI must flush before the process ends.
      if (result.exitCode !== 0) process.exitCode = result.exitCode;
      break;
    }
    case "screen":
      await runScreenManagementCommand(args, flags, defaults.storeSpecsPath);
      break;
    case "dev":
      await ensureRenderBrowsers("optional", defaults.browserSetup);
      await runDevCommand(flags, defaults.storeSpecsPath);
      break;
    case "import":
      await runImportCommand(args, flags, defaults.storeSpecsPath);
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
    case "setup":
      await runSetupCommand(defaults.browserSetup);
      break;
    case "template": {
      const storeSpecsPath = flags["store-specs"] ? resolve(flags["store-specs"]) : defaults.storeSpecsPath;
      console.log(await runTemplateCommand(resolveProjectPath(flags), storeSpecsPath, args, flags));
      break;
    }
    case "element": {
      const output = await runElementCommand(resolveProjectPath(flags), args, flags);
      if (output) console.log(output);
      break;
    }
    case "copy":
      console.log(await runCopyCommand(resolveProjectPath(flags), args, flags));
      break;
    case "upload": {
      const prepareRender = () => ensureRenderBrowsers("required", defaults.browserSetup, resolveBrowserChoice(undefined));
      if (flags.store === "apple") {
        const result = await runAppStoreUploadCommand(flags, defaults.storeSpecsPath, { prepareRender });
        console.log(result.output);
        if (result.exitCode !== 0) process.exitCode = result.exitCode;
      } else {
        console.log(await runUploadCommand(flags, defaults.storeSpecsPath, { prepareRender }));
      }
      break;
    }
    case "publishing":
      console.log(await runPublishingCommand(resolveProjectPath(flags), args, flags));
      break;
  }
}
