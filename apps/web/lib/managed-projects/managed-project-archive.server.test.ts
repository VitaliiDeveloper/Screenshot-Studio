// SPDX-License-Identifier: Apache-2.0
import { link, lstat, mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireProjectMutationLock, projectRevision } from "@screenshot-studio/core/storage";
import { ManagedProjectArchiveService } from "./managed-project-archive.server.js";
import { resolveManagedProjectStorageConfig } from "./managed-project-config.server.js";
import { ManagedProjectImportService, type ProjectImportFile } from "./managed-project-import.server.js";
import { ManagedProjectRepository } from "./managed-project-repository.server.js";

const temporaryRoots: string[] = [];

function projectJson(): string {
  return JSON.stringify({
    meta: { name: "Round trip", schemaVersion: 1, appIcon: "assets/icon.png" },
    fonts: [{ family: "Inter", source: "uploaded", path: "assets/fonts/inter.woff2", weight: 400 }],
    preferredExportLayoutId: "primary",
    layouts: [{
      id: "primary",
      name: "Primary",
      mode: "isolated",
      screens: [{
        id: "hero",
        name: "Hero",
        platform: "apple",
        device: "iphone",
        locale: "en",
        artboard: { width: 660, height: 1434 },
        background: { type: "solid", color: "#000000" },
        elements: [{
          id: "shot",
          type: "screenshot",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          assetUrl: "screenshots/hero.png",
          fit: "cover",
          cornerRadius: 0,
        }],
      }],
    }],
  });
}

function file(relativePath: string, bytes: string | Uint8Array): ProjectImportFile {
  const value = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return {
    relativePath,
    declaredSize: value.byteLength,
    async *open() { yield value; },
  };
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "managed-project-archive-"));
  temporaryRoots.push(root);
  const repository = new ManagedProjectRepository(resolveManagedProjectStorageConfig({
    SCREENSHOT_STUDIO_DATA_ROOT: root,
    SCREENSHOT_STUDIO_MAX_PROJECT_FILES: "100",
    SCREENSHOT_STUDIO_MAX_PROJECT_BYTES: "1000000",
  }));
  const imported = await new ManagedProjectImportService(repository).import({
    kind: "archive",
    files: [
      file("app-store-screenshots.json", projectJson()),
      file("assets/icon.png", new Uint8Array([1, 2, 3])),
      file("assets/fonts/inter.woff2", new Uint8Array([4, 5, 6])),
      file("screenshots/hero.png", new Uint8Array([7, 8, 9])),
      file("themes/launch.json", "{\"name\":\"Launch\"}"),
      file("templates/hero.json", "{\"name\":\"Hero\"}"),
      file("AGENTS.md", "# Guide\n"),
      file("CLAUDE.md", "@AGENTS.md\n"),
    ],
  });
  return { root, repository, imported };
}

async function archiveFiles(path: string): Promise<Map<string, Uint8Array>> {
  const zip = await JSZip.loadAsync(await readFile(path));
  const entries = new Map<string, Uint8Array>();
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!entry.dir) entries.set(name, await entry.async("uint8array"));
  }
  return entries;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ManagedProjectArchiveService", () => {
  it("exports only the complete supported portable project surface", async () => {
    const { repository, imported } = await createFixture();
    await mkdir(join(imported.projectDirectory, "export"));
    await writeFile(join(imported.projectDirectory, "export", "store.png"), "rendered");
    await writeFile(join(imported.projectDirectory, ".env"), "SECRET=never");
    await writeFile(join(imported.projectDirectory, "assets", "service-account.json"), "credential");
    await writeFile(join(imported.projectDirectory, "assets", "cache.tmp"), "temporary");

    const artifact = await new ManagedProjectArchiveService(repository).create(imported.id);
    const entries = await archiveFiles(artifact.path);

    expect([...entries.keys()].sort()).toEqual([
      "AGENTS.md",
      "CLAUDE.md",
      "app-store-screenshots.json",
      "assets/fonts/inter.woff2",
      "assets/icon.png",
      "screenshots/hero.png",
      "templates/hero.json",
      "themes/launch.json",
    ]);
    expect(entries.get("screenshots/hero.png")).toEqual(new Uint8Array([7, 8, 9]));
    expect(artifact.projectRevision).toBe(projectRevision(
      entries.get("app-store-screenshots.json")!,
    ));
    await artifact.dispose();
    await expect(lstat(artifact.path)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(artifact.dispose()).resolves.toBeUndefined();
  });

  it("fails instead of omitting a referenced resource the archive policy excludes", async () => {
    const { repository, imported } = await createFixture();
    await writeFile(join(imported.projectDirectory, "assets", "secret-sauce.png"), "image");
    await writeFile(
      imported.projectPath,
      projectJson().replace("screenshots/hero.png", "assets/secret-sauce.png"),
    );

    await expect(new ManagedProjectArchiveService(repository).create(imported.id))
      .rejects.toThrow("would omit referenced resources: assets/secret-sauce.png");
  });

  it("drains the project mutation lease before producing its immutable revision", async () => {
    const { repository, imported } = await createFixture();
    const writer = await acquireProjectMutationLock(imported.projectPath, {
      timeoutMs: 0,
      staleAfterMs: 5_000,
      retryDelayMs: 10,
      heartbeatMs: 1_000,
    });
    let settled = false;
    const creating = new ManagedProjectArchiveService(repository).create(imported.id)
      .finally(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(settled).toBe(false);
    await writer.release();

    const artifact = await creating;
    const entries = await archiveFiles(artifact.path);
    expect(artifact.projectRevision).toBe(projectRevision(
      entries.get("app-store-screenshots.json")!,
    ));
    await artifact.dispose();
  });

  it("round-trips through the same archive import contract", async () => {
    const { repository, imported } = await createFixture();
    const artifact = await new ManagedProjectArchiveService(repository).create(imported.id);
    const entries = await archiveFiles(artifact.path);
    const importedAgain = await new ManagedProjectImportService(repository).import({
      kind: "archive",
      files: [...entries].map(([relativePath, bytes]) => file(relativePath, bytes)),
    });

    await expect(readFile(importedAgain.projectPath)).resolves.toEqual(await readFile(imported.projectPath));
    await expect(readFile(join(importedAgain.projectDirectory, "assets/icon.png")))
      .resolves.toEqual(await readFile(join(imported.projectDirectory, "assets/icon.png")));
    expect(importedAgain.id).not.toBe(imported.id);
    await artifact.dispose();
  });

  it("retries artifact disposal after a transient cleanup failure", async () => {
    const { repository, imported } = await createFixture();
    const removeTemporaryRoot = vi.fn()
      .mockRejectedValueOnce(new Error("injected cleanup failure"))
      .mockImplementation((path: string) => rm(path, { recursive: true, force: true }));
    const artifact = await new ManagedProjectArchiveService(repository, { removeTemporaryRoot })
      .create(imported.id);

    await expect(artifact.dispose()).rejects.toThrow("injected cleanup failure");
    await expect(artifact.dispose()).resolves.toBeUndefined();
    expect(removeTemporaryRoot).toHaveBeenCalledTimes(2);
  });

  it("fails closed when a managed tree contains links", async () => {
    const symlinkFixture = await createFixture();
    const outside = join(symlinkFixture.root, "outside.txt");
    await writeFile(outside, "outside");
    await symlink(outside, join(symlinkFixture.imported.projectDirectory, "assets", "linked.png"));
    await expect(new ManagedProjectArchiveService(symlinkFixture.repository)
      .create(symlinkFixture.imported.id)).rejects.toThrow(/symbolic link/i);

    const hardLinkFixture = await createFixture();
    await link(
      join(hardLinkFixture.imported.projectDirectory, "assets/icon.png"),
      join(hardLinkFixture.imported.projectDirectory, "assets/copy.png"),
    );
    await expect(new ManagedProjectArchiveService(hardLinkFixture.repository)
      .create(hardLinkFixture.imported.id)).rejects.toThrow(/hard link/i);
  });

  it("fails closed when a directory binding changes during enumeration", async () => {
    const { root, repository, imported } = await createFixture();
    const assets = join(imported.projectDirectory, "assets");
    const movedAssets = join(imported.projectDirectory, "assets-original");
    const outside = join(root, "outside-assets");
    await mkdir(outside);
    await writeFile(join(outside, "icon.png"), "outside");
    let assetsStats = 0;
    const statPath = async (path: string) => {
      if (path === assets && ++assetsStats === 3) {
        await rename(assets, movedAssets);
        await symlink(outside, assets);
      }
      return lstat(path, { bigint: true });
    };

    await expect(new ManagedProjectArchiveService(repository, { statPath })
      .create(imported.id)).rejects.toThrow(/directory changed/i);
  });
});
