// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { addDirectory } from "./package-archive.mjs";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe("package archive", () => {
  it("records directory links without flattening their package-resolution topology", async () => {
    const directory = await mkdtemp(join(tmpdir(), "package-archive-"));
    directories.push(directory);
    const standalone = join(directory, "standalone");
    const dependency = join(standalone, ".pnpm", "react");
    await mkdir(dependency, { recursive: true });
    await writeFile(join(dependency, "index.js"), "export const version = 'test';\n");
    await mkdir(join(standalone, "node_modules"), { recursive: true });
    await symlink(
      dependency,
      join(standalone, "node_modules", "react"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const zip = new JSZip();
    const links = await addDirectory(zip, standalone);

    expect(links).toEqual([{
      path: "node_modules/react",
      target: ".pnpm/react",
      type: "directory",
    }]);
    expect(Object.values(zip.files).filter((entry) => !entry.dir).map((entry) => entry.name))
      .toEqual([".pnpm/react/index.js"]);
    await expect(zip.file(".pnpm/react/index.js")?.async("string"))
      .resolves.toBe("export const version = 'test';\n");
  });
});
