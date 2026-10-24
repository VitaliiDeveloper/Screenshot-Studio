// SPDX-License-Identifier: Apache-2.0
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const cliRoot = fileURLToPath(new URL("..", import.meta.url));
const sampleProject = fileURLToPath(new URL("../../../fixtures/sample/app-store-screenshots.json", import.meta.url));

describe("source-checkout bin", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("runs from an agent's project folder when the OS temp directory is not writable", async () => {
    dir = await mkdtemp(join(tmpdir(), "screenshots-source-bin-"));
    const blocker = join(dir, "file");
    await writeFile(blocker, "");
    // A temp path under a regular file fails every mkdir, like a sandbox that denies temp writes.
    const unwritableTmp = join(blocker, "tmp");
    const manifest = JSON.parse(await readFile(join(cliRoot, "package.json"), "utf8")) as {
      bin: { screenshots: string };
    };

    const { stdout } = await execFileAsync(
      process.execPath,
      [join(cliRoot, manifest.bin.screenshots), "element", "list", "--project", sampleProject],
      {
        cwd: dir,
        env: {
          ...process.env,
          TMPDIR: unwritableTmp,
          TMP: unwritableTmp,
          TEMP: unwritableTmp,
          TSX_DISABLE_CACHE: undefined,
          TSX_TSCONFIG_PATH: undefined,
        },
      },
    );

    expect(stdout).toContain('hero en headline text role=heading "Ship it"');
  }, 60_000);
});
