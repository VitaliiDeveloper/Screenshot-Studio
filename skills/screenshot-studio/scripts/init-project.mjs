#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import { spawn } from "node:child_process";
import console from "node:console";
import { access, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import process from "node:process";

const CONTROL_FILES = ["app-store-screenshots.json", "AGENTS.md", "CLAUDE.md"];

function usage() {
  return "Usage: node init-project.mjs --dir <target-folder> [--name <project-name>] [--cli <screenshots-executable>]";
}

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument !== "--dir" && argument !== "--name" && argument !== "--cli") {
      throw new Error(`Unknown argument: ${argument}\n${usage()}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}\n${usage()}`);
    }
    options[argument.slice(2)] = value;
    index += 1;
  }

  return options;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function run(command, args) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: "inherit" });

    child.once("error", (error) => rejectRun(error));
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(new Error(
        signal
          ? `Screenshot Studio CLI stopped with signal ${signal}`
          : `Screenshot Studio CLI exited with code ${code ?? "unknown"}`,
      ));
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.dir) throw new Error(`--dir is required\n${usage()}`);

  const target = resolve(options.dir);
  for (const filename of CONTROL_FILES) {
    const path = join(target, filename);
    if (await exists(path)) throw new Error(`Refusing to overwrite existing ${path}`);
  }

  const cli = options.cli || process.env.SCREENSHOT_STUDIO_CLI || "screenshots";
  const args = ["init", "--dir", target];
  if (options.name) args.push("--name", options.name);

  try {
    // No shell, so the project name and folder are never parsed as shell syntax. Windows cannot
    // start npm's .cmd shims without one, so it needs the CLI's JavaScript entry.
    await run(...(/\.[cm]?js$/i.test(cli) ? [process.execPath, [cli, ...args]] : [cli, args]));
  } catch (error) {
    if (error && typeof error === "object" && (error.code === "ENOENT" || error.code === "EINVAL")) {
      throw new Error(
        `Screenshot Studio CLI not found: ${cli}. Make the built @screenshot-studio/cli artifact available on PATH, pass --cli, or set SCREENSHOT_STUDIO_CLI (on Windows, to its dist/index.js).`,
        { cause: error },
      );
    }
    throw error;
  }

  const guidePath = join(target, "AGENTS.md");
  const guide = await readFile(guidePath, "utf8");
  if (!guide.trim()) throw new Error(`Generated project guide is empty: ${guidePath}`);
  console.log(`Screenshot Studio project is ready. Read ${guidePath} before continuing.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
