// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { execFile as execFileCallback } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { pnpmCommand } from "./pnpm-command.mjs";

const execFile = promisify(execFileCallback);

describe("pnpmCommand", () => {
  it("runs a JavaScript entry with the current Node.js", () => {
    expect(pnpmCommand(["pack"], { npm_execpath: "/p/bin/pnpm.mjs" }, "darwin"))
      .toEqual([process.execPath, ["/p/bin/pnpm.mjs", "pack"]]);
  });

  it("starts native and placeholder entries through a POSIX shell", () => {
    expect(pnpmCommand(["pack"], { npm_execpath: "/p/bin/pnpm" }, "linux"))
      .toEqual(["/bin/sh", ["-c", 'exec "$0" "$@"', "/p/bin/pnpm", "pack"]]);
  });

  it("falls back to pnpm on PATH when started outside pnpm", () => {
    expect(pnpmCommand(["pack"], {}, "darwin")).toEqual(["/bin/sh", ["-c", 'exec "$0" "$@"', "pnpm", "pack"]]);
  });

  it("keeps Windows on Node.js unless the entry is a native executable", () => {
    expect(pnpmCommand(["pack"], { npm_execpath: "C:\\p\\pnpm.cjs" }, "win32"))
      .toEqual([process.execPath, ["C:\\p\\pnpm.cjs", "pack"]]);
    expect(pnpmCommand(["pack"], { npm_execpath: "C:\\p\\pnpm.EXE" }, "win32")).toEqual(["C:\\p\\pnpm.EXE", ["pack"]]);
    expect(() => pnpmCommand(["pack"], {}, "win32")).toThrow("pnpm entrypoint is unavailable");
  });

  // Direct execFile of such a file fails with ENOEXEC on macOS; glibc's execvp falls back to sh on Linux.
  it.skipIf(process.platform === "win32")("starts a shebang-less placeholder", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pnpm-command-"));
    try {
      const placeholder = join(directory, "pnpm");
      await writeFile(placeholder, 'echo "placeholder $*"\n');
      await chmod(placeholder, 0o755);
      const [executable, args] = pnpmCommand(["pack", "a b"], { npm_execpath: placeholder });
      expect((await execFile(executable, args)).stdout).toBe("placeholder pack a b\n");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
