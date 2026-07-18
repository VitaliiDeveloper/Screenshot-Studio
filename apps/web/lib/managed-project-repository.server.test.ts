// SPDX-License-Identifier: Apache-2.0
import {
  link,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ManagedProjectCatalogEntry } from "./managed-project-catalog.server.js";
import { resolveManagedProjectStorageConfig } from "./managed-project-config.server.js";
import { ManagedProjectRepository } from "./managed-project-repository.server.js";

const temporaryRoots: string[] = [];

async function createRepository() {
  const root = await mkdtemp(join(tmpdir(), "managed-project-repository-"));
  temporaryRoots.push(root);
  return new ManagedProjectRepository(resolveManagedProjectStorageConfig({
    SCREENSHOT_STUDIO_DATA_ROOT: root,
    SCREENSHOT_STUDIO_MAX_PROJECT_FILES: "10",
    SCREENSHOT_STUDIO_MAX_PROJECT_BYTES: "100000",
  }));
}

function validProjectJson(name = "Managed") {
  return JSON.stringify({
    meta: { name, schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "primary",
    layouts: [{
      id: "primary",
      name: "Primary",
      mode: "isolated",
      screens: [{
        id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
        artboard: { width: 660, height: 1434 },
        background: { type: "solid", color: "#000000" }, elements: [],
      }],
    }],
  });
}

async function validStage(repository: ManagedProjectRepository, name = "Managed") {
  const stage = await repository.createStage();
  await writeFile(join(stage.path, "app-store-screenshots.json"), validProjectJson(name));
  return stage;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ManagedProjectRepository", () => {
  it("creates opaque owned stages and rejects traversal tokens", async () => {
    const repository = await createRepository();
    const stage = await repository.createStage();

    expect(stage.token).toMatch(/^stage_[0-9a-f]{32}$/);
    expect(basename(stage.path)).toBe(stage.token);
    await expect(repository.publishStage({ token: "../escape" })).rejects.toThrow(/token/i);
  });

  it("rejects symlinks, hard links, missing project documents, and invalid project JSON", async () => {
    const repository = await createRepository();
    const outside = join(temporaryRoots[0]!, "outside.txt");
    await writeFile(outside, "outside");

    const linked = await validStage(repository);
    await mkdir(join(linked.path, "assets"));
    await symlink(outside, join(linked.path, "assets", "escape.txt"));
    await expect(repository.publishStage({ token: linked.token })).rejects.toThrow(/symbolic link/i);

    const hardLinked = await validStage(repository);
    await link(join(hardLinked.path, "app-store-screenshots.json"), join(hardLinked.path, "copy.json"));
    await expect(repository.publishStage({ token: hardLinked.token })).rejects.toThrow(/hard link/i);

    const missing = await repository.createStage();
    await expect(repository.publishStage({ token: missing.token })).rejects.toThrow(/app-store-screenshots\.json/i);

    const invalid = await repository.createStage();
    await writeFile(join(invalid.path, "app-store-screenshots.json"), "not JSON");
    await expect(repository.publishStage({ token: invalid.token })).rejects.toThrow();
  });

  it("enforces configured file and byte limits before publication", async () => {
    const root = await mkdtemp(join(tmpdir(), "managed-project-repository-"));
    temporaryRoots.push(root);
    const repository = new ManagedProjectRepository(resolveManagedProjectStorageConfig({
      SCREENSHOT_STUDIO_DATA_ROOT: root,
      SCREENSHOT_STUDIO_MAX_PROJECT_FILES: "1",
      SCREENSHOT_STUDIO_MAX_PROJECT_BYTES: "100000",
    }));
    const tooManyFiles = await validStage(repository);
    await writeFile(join(tooManyFiles.path, "extra.txt"), "extra");
    await expect(repository.publishStage({ token: tooManyFiles.token })).rejects.toThrow(/file limit/i);

    const byteLimited = new ManagedProjectRepository(resolveManagedProjectStorageConfig({
      SCREENSHOT_STUDIO_DATA_ROOT: root,
      SCREENSHOT_STUDIO_MAX_PROJECT_FILES: "10",
      SCREENSHOT_STUDIO_MAX_PROJECT_BYTES: "1",
    }));
    const tooLarge = await validStage(byteLimited);
    await expect(byteLimited.publishStage({ token: tooLarge.token })).rejects.toThrow(/byte limit/i);
  });

  it("publishes a validated stage only when its catalog entry is durable and reopens it", async () => {
    const repository = await createRepository();
    const stage = await validStage(repository, "Alpha");

    const published = await repository.publishStage({ token: stage.token });

    expect(published).toMatchObject({ id: expect.stringMatching(/^project_[0-9a-f]{32}$/), name: "Alpha" });
    await expect(lstat(published.projectDirectory)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(repository.list()).resolves.toMatchObject([{ id: published.id, name: "Alpha" }]);
    await expect(repository.open(published.id)).resolves.toEqual(published);
  });

  it("rolls a published directory back to its owned stage when catalog insertion fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "managed-project-repository-"));
    temporaryRoots.push(root);
    const config = resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: root });
    const repository = new ManagedProjectRepository(config, {
      catalog: {
        read: async () => ({ version: 1, entries: [] }),
        get: async () => undefined,
        list: async () => [],
        insert: async () => { throw new Error("injected catalog failure"); },
        remove: async () => undefined,
      },
    });
    const stage = await validStage(repository);

    await expect(repository.publishStage({ token: stage.token })).rejects.toThrow("injected catalog failure");
    await expect(readFile(join(stage.path, "app-store-screenshots.json"), "utf8")).resolves.toContain("Managed");
  });

  it("reconciles a published directory that has not reached catalog visibility", async () => {
    const repository = await createRepository();
    await repository.initialize();
    const id = "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const token = "stage_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const directory = join(repository.config.projectsRoot, id);
    await mkdir(directory);
    await writeFile(join(directory, "app-store-screenshots.json"), validProjectJson("Recovered"));
    await writeFile(join(repository.config.recoveryRoot, `${id}.json`), `${JSON.stringify({
      version: 1,
      operation: "publish",
      id,
      token,
      name: "Recovered",
      createdAt: "2026-07-18T00:00:00.000Z",
      phase: "directory-published",
    })}\n`);

    await repository.initialize();

    await expect(repository.list()).resolves.toMatchObject([{ id, name: "Recovered" }]);
    await expect(lstat(join(repository.config.recoveryRoot, `${id}.json`))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("retains a valid published directory and recovery intent when reconciliation cannot insert the catalog entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "managed-project-repository-"));
    temporaryRoots.push(root);
    const config = resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: root });
    const repository = new ManagedProjectRepository(config, {
      catalog: {
        read: async () => ({ version: 1, entries: [] }),
        get: async () => undefined,
        list: async () => [],
        insert: async () => { throw new Error("injected recovery insert failure"); },
        remove: async () => undefined,
      },
    });
    await repository.initialize();
    const id = "project_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const token = "stage_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const directory = join(config.projectsRoot, id);
    const intentPath = join(config.recoveryRoot, `${id}.json`);
    await mkdir(directory);
    await writeFile(join(directory, "app-store-screenshots.json"), validProjectJson("Retry later"));
    await writeFile(intentPath, `${JSON.stringify({
      version: 1,
      operation: "publish",
      id,
      token,
      name: "Retry later",
      createdAt: "2026-07-18T00:00:00.000Z",
      phase: "directory-published",
    })}\n`);

    await expect(repository.initialize()).rejects.toThrow("injected recovery insert failure");

    await expect(lstat(directory)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(lstat(intentPath)).resolves.toMatchObject({ isFile: expect.any(Function) });
    await expect(lstat(join(config.stagingRoot, token))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the project directory published when catalog rollback fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "managed-project-repository-"));
    temporaryRoots.push(root);
    const config = resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: root });
    let catalogEntry: ManagedProjectCatalogEntry | undefined;
    const entries: ManagedProjectCatalogEntry[] = [];
    let renameCalls = 0;
    const repository = new ManagedProjectRepository(config, {
      randomId: () => "cccccccccccccccccccccccccccccccc",
      rename: async (oldPath, newPath) => {
        renameCalls += 1;
        if (renameCalls === 4) throw new Error("injected final intent failure");
        await rename(oldPath, newPath);
      },
      catalog: {
        read: async () => ({ version: 1, entries }),
        get: async (id) => entries.find((entry) => entry.id === id),
        list: async () => entries,
        insert: async (entry) => { entries.push(entry); catalogEntry = entry; },
        remove: async () => { throw new Error("injected catalog rollback failure"); },
      },
    });
    const stage = await validStage(repository, "Committed");
    const id = "project_cccccccccccccccccccccccccccccccc";
    const projectDirectory = join(config.projectsRoot, id);

    await expect(repository.publishStage({ token: stage.token })).rejects.toThrow(
      "Managed project publication rollback failed",
    );

    expect(catalogEntry).toBeDefined();
    await expect(lstat(projectDirectory)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(lstat(stage.path)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(join(config.recoveryRoot, `${id}.json`))).resolves.toMatchObject({
      isFile: expect.any(Function),
    });
  });

  it("rejects a non-canonical recovery timestamp before mutating the catalog", async () => {
    const repository = await createRepository();
    await repository.initialize();
    const id = "project_dddddddddddddddddddddddddddddddd";
    const token = "stage_dddddddddddddddddddddddddddddddd";
    const directory = join(repository.config.projectsRoot, id);
    const intentPath = join(repository.config.recoveryRoot, `${id}.json`);
    await mkdir(directory);
    await writeFile(join(directory, "app-store-screenshots.json"), validProjectJson("Invalid recovery"));
    await writeFile(intentPath, `${JSON.stringify({
      version: 1,
      operation: "publish",
      id,
      token,
      name: "Invalid recovery",
      createdAt: "not-an-iso-timestamp",
      phase: "directory-published",
    })}\n`);

    await expect(repository.initialize()).rejects.toThrow(/recovery intent/i);

    await expect(readFile(repository.config.catalogPath, "utf8")).resolves.toContain('"entries": []');
    await expect(lstat(intentPath)).resolves.toMatchObject({ isFile: expect.any(Function) });
  });
});
