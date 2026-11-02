// SPDX-License-Identifier: Apache-2.0
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const script = fileURLToPath(new URL("../skills/screenshot-studio/scripts/init-project.mjs", import.meta.url));
let directory: string;

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it("passes the project name to a JavaScript CLI as one literal argument", async () => {
  directory = await mkdtemp(join(tmpdir(), "screenshot-studio-skill-init-"));
  const cli = join(directory, "fake-cli.mjs");
  await writeFile(cli, [
    'import { mkdirSync, writeFileSync } from "node:fs";',
    "const args = process.argv.slice(2);",
    'const dir = args[args.indexOf("--dir") + 1];',
    "mkdirSync(dir, { recursive: true });",
    'writeFileSync(`${dir}/AGENTS.md`, JSON.stringify(args));',
  ].join("\n"));
  const target = join(directory, "project");
  const name = 'x & echo injected "two words"';

  await execFile(process.execPath, [script, "--dir", target, "--name", name, "--cli", cli]);

  expect(JSON.parse(await readFile(join(target, "AGENTS.md"), "utf8"))).toEqual(["init", "--dir", target, "--name", name]);
});
