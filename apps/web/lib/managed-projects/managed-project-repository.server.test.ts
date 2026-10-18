// SPDX-License-Identifier: Apache-2.0
import {
  link,
  lstat,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ActiveManagedProjectCatalogEntry, ManagedProjectCatalogEntry } from "./managed-project-catalog.server.js";
import { ManagedProjectCatalogStore } from "./managed-project-catalog.server.js";
import { resolveManagedProjectStorageConfig } from "./managed-project-config.server.js";
import {
  ManagedProjectNotFoundError,
  ManagedProjectRepository,
} from "./managed-project-repository.server.js";

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
  it("rejects a symlinked configured root before creating managed children in its target", async () => {
    const container = await mkdtemp(join(tmpdir(), "managed-project-root-symlink-"));
    temporaryRoots.push(container);
    const outside = join(container, "outside");
    const declared = join(container, "declared");
    await mkdir(outside);
    await symlink(outside, declared);
    const repository = new ManagedProjectRepository(resolveManagedProjectStorageConfig({
      SCREENSHOT_STUDIO_DATA_ROOT: declared,
    }));

    await expect(repository.initialize()).rejects.toThrow(/storage root/i);
    await expect(readdir(outside)).resolves.toEqual([]);
  });

  it("configures a bounded import upload and rejects invalid values", () => {
    expect(resolveManagedProjectStorageConfig({
      SCREENSHOT_STUDIO_DATA_ROOT: "/tmp/managed-project-config",
    }).maxImportUploadBytes).toBe(268_435_456);
    expect(resolveManagedProjectStorageConfig({
      SCREENSHOT_STUDIO_DATA_ROOT: "/tmp/managed-project-config",
      SCREENSHOT_STUDIO_MAX_IMPORT_UPLOAD_BYTES: "1024",
    }).maxImportUploadBytes).toBe(1024);
    expect(() => resolveManagedProjectStorageConfig({
      SCREENSHOT_STUDIO_DATA_ROOT: "/tmp/managed-project-config",
      SCREENSHOT_STUDIO_MAX_IMPORT_UPLOAD_BYTES: "0",
    })).toThrow(/SCREENSHOT_STUDIO_MAX_IMPORT_UPLOAD_BYTES/);
  });

  it("creates opaque owned stages and rejects traversal tokens", async () => {
    const repository = await createRepository();
    const stage = await repository.createStage();

    expect(stage.token).toMatch(/^stage_[0-9a-f]{32}$/);
    expect(basename(stage.path)).toBe(stage.token);
    await expect(repository.publishStage({ token: "../escape" })).rejects.toThrow(/token/i);
  });

  it("discards only an exact owned unpublished stage", async () => {
    const repository = await createRepository();
    const stage = await validStage(repository);

    await repository.discardStage(stage.token);

    await expect(lstat(stage.path)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(repository.discardStage("../escape")).rejects.toThrow(/token/i);
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

  it("never reuses the reserved project id after publication fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "managed-project-id-retirement-"));
    temporaryRoots.push(root);
    const config = resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: root });
    const catalog = new ManagedProjectCatalogStore(config, {
      createIdNamespace: () => "1234567890abcdef",
    });
    const repository = new ManagedProjectRepository(config, {
      catalog: {
        read: () => catalog.read(),
        get: (id) => catalog.get(id),
        list: () => catalog.list(),
        reserveProjectId: () => catalog.reserveProjectId(),
        insert: async () => { throw new Error("injected catalog insertion failure"); },
        removeActive: (id, revision) => catalog.removeActive(id, revision),
      },
    });
    const stage = await validStage(repository);

    await expect(repository.publishStage({ token: stage.token }))
      .rejects.toThrow("injected catalog insertion failure");
    await expect(catalog.reserveProjectId()).resolves.toBe(
      "project_1234567890abcdef0000000000000002",
    );
  });

  it("keeps recovery from completing a publication that is still in flight", async () => {
    const observer = await createRepository();
    const catalog = new ManagedProjectCatalogStore(observer.config);
    let recovery: Promise<void> | undefined;
    const repository = new ManagedProjectRepository(observer.config, {
      catalog: {
        read: () => catalog.read(),
        get: (id) => catalog.get(id),
        list: () => catalog.list(),
        reserveProjectId: () => catalog.reserveProjectId(),
        // A concurrent request (the launcher listing projects) reconciles between directory and catalog publication.
        insert: async (entry) => {
          recovery ??= observer.reconcile();
          await Promise.race([recovery, new Promise((resolve) => setTimeout(resolve, 200))]);
          return catalog.insert(entry);
        },
        removeActive: (id, revision) => catalog.removeActive(id, revision),
      },
    });
    const stage = await validStage(repository, "In flight");

    const published = await repository.publishStage({ token: stage.token });
    await recovery;

    await expect(observer.list()).resolves.toMatchObject([{ id: published.id, name: "In flight" }]);
    await expect(lstat(published.projectDirectory)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(readdir(observer.config.recoveryRoot)).resolves.toEqual([]);
  });

  it("reports a missing catalog entry with the dedicated recovery error", async () => {
    const repository = await createRepository();

    await expect(repository.open("project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"))
      .rejects.toBeInstanceOf(ManagedProjectNotFoundError);
  });

  it("rejects redirected staging and recovery roots before journal access or cleanup", async () => {
    for (const child of ["stagingRoot", "recoveryRoot"] as const) {
      const repository = await createRepository();
      await repository.initialize();
      const outside = join(repository.config.root, `outside-${child}`);
      await mkdir(outside);
      await writeFile(join(outside, "keep.txt"), "keep");
      await rm(repository.config[child], { recursive: true });
      await symlink(outside, repository.config[child]);

      await expect(repository.initialize()).rejects.toThrow(/storage boundary/i);
      await expect(readFile(join(outside, "keep.txt"), "utf8")).resolves.toBe("keep");
    }
  });

  it("rolls a published directory back to its owned stage when catalog insertion fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "managed-project-repository-"));
    temporaryRoots.push(root);
    const config = resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: root });
    const repository = new ManagedProjectRepository(config, {
      catalog: {
        read: async () => ({
          version: 1, generation: 0, idNamespace: "aaaaaaaaaaaaaaaa",
          nextProjectOrdinal: 2, entries: [], deletions: [],
        }),
        get: async () => undefined,
        list: async () => [],
        reserveProjectId: async () => "project_aaaaaaaaaaaaaaaa0000000000000001",
        insert: async () => { throw new Error("injected catalog failure"); },
        removeActive: async () => undefined,
      },
    });
    const stage = await validStage(repository);

    await expect(repository.publishStage({ token: stage.token })).rejects.toThrow("injected catalog failure");
    await expect(readFile(join(stage.path, "app-store-screenshots.json"), "utf8")).resolves.toContain("Managed");
  });

  it("cleans a rolled-back stage whose directory-published intent outlived cleanup", async () => {
    const repository = await createRepository();
    await repository.initialize();
    const stage = await validStage(repository, "Rolled back");
    const id = "project_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    const intentPath = join(repository.config.recoveryRoot, `${id}.json`);
    await writeFile(intentPath, `${JSON.stringify({
      version: 1,
      operation: "publish",
      id,
      token: stage.token,
      name: "Rolled back",
      createdAt: "2026-07-19T00:00:00.000Z",
      phase: "directory-published",
    })}\n`);

    await repository.initialize();

    await expect(repository.list()).resolves.toEqual([]);
    await expect(lstat(stage.path)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(intentPath)).rejects.toMatchObject({ code: "ENOENT" });
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
        read: async () => ({
          version: 1, generation: 0, idNamespace: "bbbbbbbbbbbbbbbb",
          nextProjectOrdinal: 2, entries: [], deletions: [],
        }),
        get: async () => undefined,
        list: async () => [],
        reserveProjectId: async () => "project_bbbbbbbbbbbbbbbb0000000000000001",
        insert: async () => { throw new Error("injected recovery insert failure"); },
        removeActive: async () => undefined,
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
    const entries: ActiveManagedProjectCatalogEntry[] = [];
    let renameCalls = 0;
    const repository = new ManagedProjectRepository(config, {
      randomId: () => "cccccccccccccccccccccccccccccccc",
      rename: async (oldPath, newPath) => {
        renameCalls += 1;
        if (renameCalls === 4) throw new Error("injected final intent failure");
        await rename(oldPath, newPath);
      },
      catalog: {
        read: async () => ({
          version: 1, generation: 0, idNamespace: "cccccccccccccccc",
          nextProjectOrdinal: 2, entries, deletions: [],
        }),
        get: async (id) => entries.find((entry) => entry.id === id),
        list: async () => entries,
        reserveProjectId: async () => "project_cccccccccccccccc0000000000000001",
        insert: async (entry) => { entries.push(entry); catalogEntry = entry; },
        removeActive: async () => { throw new Error("injected catalog rollback failure"); },
      },
    });
    const stage = await validStage(repository, "Committed");
    const id = "project_cccccccccccccccc0000000000000001";
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
