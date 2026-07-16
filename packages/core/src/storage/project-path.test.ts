// SPDX-License-Identifier: Apache-2.0
import { link, lstat, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectPathError, resolveExistingProjectPath } from "./project-path.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "screenshot-studio-project-path-"));
  temporaryRoots.push(directory);
  return directory;
}

describe("existing project path identity", () => {
  it("resolves a symlink alias to its canonical absolute regular-file target", async () => {
    const directory = await temporaryDirectory();
    const projectPath = join(directory, "app-store-screenshots.json");
    const aliasPath = join(directory, "project-alias.json");
    await writeFile(projectPath, "{}\n");
    await symlink(projectPath, aliasPath);

    await expect(resolveExistingProjectPath(aliasPath)).resolves.toBe(await realpath(projectPath));
  });

  it("rejects a directory target with an actionable project-path error", async () => {
    const directory = await temporaryDirectory();

    await expect(resolveExistingProjectPath(directory)).rejects.toMatchObject({
      name: "ProjectPathError",
      message: expect.stringMatching(/regular file/),
    });
    await expect(resolveExistingProjectPath(directory)).rejects.toBeInstanceOf(ProjectPathError);
  });

  it("rejects hard-linked project files so aliases cannot bypass lock identity", async () => {
    const directory = await temporaryDirectory();
    const projectPath = join(directory, "app-store-screenshots.json");
    const hardLinkPath = join(directory, "hard-link.json");
    await writeFile(projectPath, "{}\n");
    await link(projectPath, hardLinkPath);

    await expect(resolveExistingProjectPath(projectPath)).rejects.toThrow(/hard links.*copy/i);
    await expect(resolveExistingProjectPath(hardLinkPath)).rejects.toThrow(/hard links.*copy/i);
    expect((await lstat(projectPath)).nlink).toBe(2);
    expect((await lstat(hardLinkPath)).nlink).toBe(2);
  });

  it("preserves an app-shaped stage name when it is not a hard link to the project", async () => {
    const directory = await temporaryDirectory();
    const projectPath = join(directory, "app-store-screenshots.json");
    const hardLinkPath = join(directory, "unknown-hard-link.json");
    const stageLookalike = join(
      directory,
      ".app-store-screenshots.json.45eb10e2-0449-4bdd-bf79-674090b656a2.tmp",
    );
    await writeFile(projectPath, "{}\n");
    await link(projectPath, hardLinkPath);
    await writeFile(stageLookalike, "independent sentinel");

    await expect(resolveExistingProjectPath(projectPath)).rejects.toThrow(/hard links.*copy/i);

    expect(await readFile(stageLookalike, "utf8")).toBe("independent sentinel");
    expect((await lstat(projectPath)).nlink).toBe(2);
    expect((await lstat(hardLinkPath)).nlink).toBe(2);
  });
});
