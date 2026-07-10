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
  it("archives directory links as portable regular files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "package-archive-"));
    directories.push(directory);
    const dependency = join(directory, "dependencies", "react");
    await mkdir(dependency, { recursive: true });
    await writeFile(join(dependency, "index.js"), "export const version = 'test';\n");
    await mkdir(join(directory, "standalone", "node_modules"), { recursive: true });
    await symlink(
      dependency,
      join(directory, "standalone", "node_modules", "react"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const zip = new JSZip();
    await addDirectory(zip, join(directory, "standalone"));

    expect(Object.values(zip.files).filter((entry) => !entry.dir).map((entry) => entry.name))
      .toEqual(["node_modules/react/index.js"]);
    await expect(zip.file("node_modules/react/index.js")?.async("string"))
      .resolves.toBe("export const version = 'test';\n");
  });
});
