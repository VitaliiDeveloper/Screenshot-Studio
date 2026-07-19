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
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { acquireProjectMutationLock, readProjectSnapshot } from "@screenshot-studio/core/storage";
import type { ActiveManagedProjectCatalogEntry, ManagedProjectCatalogEntry } from "./managed-project-catalog.server.js";
import { ManagedProjectCatalogStore } from "./managed-project-catalog.server.js";
import { resolveManagedProjectStorageConfig } from "./managed-project-config.server.js";
import { acquireManagedProjectLifecycleLock } from "./managed-project-lifecycle-lock.server.js";
import {
  ManagedProjectNotFoundError,
  ManagedProjectRepository,
} from "./managed-project-repository.server.js";

const temporaryRoots: string[] = [];
const childProcesses = new Set<ChildProcess>();
const managedPutChild = fileURLToPath(new URL("./fixtures/managed-put-child.ts", import.meta.url));

function waitForChildOutput(child: ChildProcess, expected: string, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${expected}; stderr: ${stderr}`));
    }, timeoutMs);
    const onStdout = (chunk: Buffer | string) => {
      stdout += chunk.toString();
      if (stdout.includes(expected)) { cleanup(); resolve(); }
    };
    const onStderr = (chunk: Buffer | string) => { stderr += chunk.toString(); };
    const onExit = (code: number | null) => {
      cleanup();
      if (!stdout.includes(expected)) reject(new Error(`child exited ${code}; stderr: ${stderr}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.off("exit", onExit);
    };
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.once("exit", onExit);
  });
}

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

async function directoryIdentity(path: string) {
  const info = await stat(path, { bigint: true });
  return { device: info.dev.toString(), inode: info.ino.toString() };
}

async function validStage(repository: ManagedProjectRepository, name = "Managed") {
  const stage = await repository.createStage();
  await writeFile(join(stage.path, "app-store-screenshots.json"), validProjectJson(name));
  return stage;
}

afterEach(async () => {
  for (const child of childProcesses) child.kill("SIGKILL");
  childProcesses.clear();
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

  it("reports a missing catalog entry with the dedicated recovery error", async () => {
    const repository = await createRepository();

    await expect(repository.open("project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"))
      .rejects.toBeInstanceOf(ManagedProjectNotFoundError);
  });

  it("excludes trashed records from active lookup and exposes only a bounded Trash listing", async () => {
    const repository = await createRepository();
    const published = await repository.publishStage({ token: (await validStage(repository, "Trash me")).token });
    const catalog = new ManagedProjectCatalogStore(repository.config);
    await catalog.transitionToTrashed(published.id, 1, "2026-07-19T00:00:00.000Z");

    await expect(repository.open(published.id)).rejects.toBeInstanceOf(ManagedProjectNotFoundError);
    await expect(repository.list()).resolves.toEqual([]);
    await expect(repository.listTrash(1)).resolves.toMatchObject([{
      id: published.id,
      name: "Trash me",
      lifecycleRevision: 2,
      trashedAt: "2026-07-19T00:00:00.000Z",
      capabilities: { restoreProject: true, purgeProject: true },
    }]);
  });

  it("moves an active managed project to application Trash and preserves identity and resources", async () => {
    const repository = await createRepository();
    const published = await repository.publishStage({ token: (await validStage(repository, "Trash me")).token });
    await mkdir(join(published.projectDirectory, "assets"));
    await writeFile(join(published.projectDirectory, "assets", "keep.txt"), "resource");

    const trashed = await repository.moveToTrash(published.id, published.lifecycleRevision);

    expect(trashed).toMatchObject({ id: published.id, lifecycleRevision: 2, lifecycle: "trashed" });
    await expect(lstat(published.projectDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(repository.config.trashRoot, published.id, "assets", "keep.txt"), "utf8"))
      .resolves.toBe("resource");
    await expect(repository.open(published.id)).rejects.toBeInstanceOf(ManagedProjectNotFoundError);
  });

  it("rejects stale lifecycle revisions and destination conflicts before moving", async () => {
    const repository = await createRepository();
    const published = await repository.publishStage({ token: (await validStage(repository)).token });
    await expect(repository.moveToTrash(published.id, 2)).rejects.toThrow(/revision/i);
    await mkdir(join(repository.config.trashRoot, published.id));
    await expect(repository.moveToTrash(published.id, 1)).rejects.toThrow(/destination/i);
    await expect(repository.open(published.id)).resolves.toMatchObject({ id: published.id });
  });

  it("rejects lifecycle overflow and a symlinked Trash root before any directory move", async () => {
    const overflowRepository = await createRepository();
    await overflowRepository.initialize();
    const overflowId = "project_ffffffffffffffffffffffffffffffff";
    const overflowDirectory = join(overflowRepository.config.projectsRoot, overflowId);
    await mkdir(overflowDirectory);
    await writeFile(join(overflowDirectory, "app-store-screenshots.json"), validProjectJson("Overflow"));
    const timestamp = "2026-07-19T00:00:00.000Z";
    await new ManagedProjectCatalogStore(overflowRepository.config).insert({
      id: overflowId,
      directoryName: overflowId,
      name: "Overflow",
      lifecycle: "active",
      lifecycleRevision: Number.MAX_SAFE_INTEGER,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await expect(overflowRepository.moveToTrash(overflowId, Number.MAX_SAFE_INTEGER))
      .rejects.toThrow(/increment|revision/i);
    await expect(lstat(overflowDirectory)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(lstat(join(overflowRepository.config.trashRoot, overflowId)))
      .rejects.toMatchObject({ code: "ENOENT" });

    const linkedRepository = await createRepository();
    const linked = await linkedRepository.publishStage({ token: (await validStage(linkedRepository, "Boundary")).token });
    const outsideTrash = join(linkedRepository.config.root, "outside-trash");
    await mkdir(outsideTrash);
    await rm(linkedRepository.config.trashRoot, { recursive: true });
    await symlink(outsideTrash, linkedRepository.config.trashRoot);

    await expect(linkedRepository.moveToTrash(linked.id, 1)).rejects.toThrow(/storage boundary/i);
    await expect(lstat(linked.projectDirectory)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(readdir(outsideTrash)).resolves.toEqual([]);
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

  it("drains an existing project mutation and releases its project-local lease before rename", async () => {
    const repository = await createRepository();
    const published = await repository.publishStage({ token: (await validStage(repository)).token });
    const projectLock = await acquireProjectMutationLock(published.projectPath, {
      timeoutMs: 0, staleAfterMs: 5_000, retryDelayMs: 10, heartbeatMs: 1_000,
    });
    let settled = false;
    const moving = repository.moveToTrash(published.id, 1).finally(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(settled).toBe(false);
    await projectLock.release();

    await expect(moving).resolves.toMatchObject({ lifecycle: "trashed" });
  });

  it("rejects a real child-process PUT that races after Trash drains project writes", async () => {
    const root = await mkdtemp(join(tmpdir(), "managed-project-put-race-"));
    temporaryRoots.push(root);
    const config = resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: root });
    let reachedMove!: () => void;
    const moveReached = new Promise<void>((resolve) => { reachedMove = resolve; });
    let continueMove!: () => void;
    const moveCanContinue = new Promise<void>((resolve) => { continueMove = resolve; });
    const repository = new ManagedProjectRepository(config, {
      trashFailpoint: async (point) => {
        if (point !== "after-directory-move") return;
        reachedMove();
        await moveCanContinue;
      },
    });
    const published = await repository.publishStage({ token: (await validStage(repository, "Original")).token });
    const revision = (await readProjectSnapshot(published.projectPath)).revision;
    const moving = repository.moveToTrash(published.id, 1);
    await moveReached;
    const child = spawn(process.execPath, ["--import", "tsx", managedPutChild, config.root, published.id, revision], {
      cwd: join(dirname(managedPutChild), "..", ".."),
      stdio: ["ignore", "pipe", "pipe"],
    });
    childProcesses.add(child);
    const childExited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    await waitForChildOutput(child, "starting\n");
    const completedWhileLocked = await Promise.race([
      waitForChildOutput(child, "status:").then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 150)),
    ]);
    expect(completedWhileLocked).toBe(false);

    continueMove();
    await expect(moving).resolves.toMatchObject({ lifecycle: "trashed" });
    await waitForChildOutput(child, "status:409\n");
    await childExited;
    childProcesses.delete(child);
    const project = JSON.parse(await readFile(join(config.trashRoot, published.id, "app-store-screenshots.json"), "utf8")) as {
      meta: { name: string };
    };
    expect(project.meta.name).toBe("Original");
  });

  it("fails closed for changed links, cross-device moves, and injected post-rename crashes", async () => {
    const linkedRepository = await createRepository();
    const linked = await linkedRepository.publishStage({ token: (await validStage(linkedRepository)).token });
    await symlink(join(linkedRepository.config.root, "outside"), join(linked.projectDirectory, "escape"));
    await expect(linkedRepository.moveToTrash(linked.id, 1)).rejects.toThrow(/symbolic link/i);
    await expect(new ManagedProjectCatalogStore(linkedRepository.config).get(linked.id))
      .resolves.toMatchObject({ id: linked.id, lifecycle: "active" });
    await expect(lstat(linked.projectDirectory)).resolves.toMatchObject({ isDirectory: expect.any(Function) });

    const root = await mkdtemp(join(tmpdir(), "managed-project-trash-failure-"));
    temporaryRoots.push(root);
    const config = resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: root });
    let directoryMoveSeen = false;
    const crashing = new ManagedProjectRepository(config, {
      rename: async (from, to) => {
        if (from.includes("/projects/project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
          && to.includes("/trash/project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")) {
          directoryMoveSeen = true;
          await rename(from, to);
          throw Object.assign(new Error("cross-device/injected crash"), { code: "EXDEV" });
        }
        await rename(from, to);
      },
      randomId: () => "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    const published = await crashing.publishStage({ token: (await validStage(crashing)).token });
    await expect(crashing.moveToTrash(published.id, 1)).rejects.toThrow(/cross-device|crash/i);
    expect(directoryMoveSeen).toBe(true);

    const restarted = new ManagedProjectRepository(config);
    await restarted.initialize();
    await expect(restarted.list()).resolves.toEqual([]);
    await expect(restarted.listTrash(1)).resolves.toMatchObject([{ id: published.id }]);
  });

  it("reconciles every safe Trash truth-table direction and retains hard conflicts", async () => {
    const preparedRepository = await createRepository();
    const prepared = await preparedRepository.publishStage({ token: (await validStage(preparedRepository, "Prepared")).token });
    const preparedEntry = await new ManagedProjectCatalogStore(preparedRepository.config).get(prepared.id);
    const preparedIntentPath = join(preparedRepository.config.recoveryRoot, `${prepared.id}.json`);
    await writeFile(preparedIntentPath, `${JSON.stringify({
      version: 2,
      operation: "trash",
      operationId: "operation_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      id: prepared.id,
      expectedLifecycleRevision: 1,
      trashedAt: "2026-07-19T00:00:00.000Z",
      priorEntry: preparedEntry,
      sourceIdentity: await directoryIdentity(prepared.projectDirectory),
      destinationIdentity: null,
      phase: "prepared",
    }, null, 2)}\n`);

    await preparedRepository.initialize();
    await expect(lstat(preparedIntentPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(preparedRepository.open(prepared.id)).resolves.toMatchObject({ id: prepared.id });

    const committedRepository = await createRepository();
    const committed = await committedRepository.publishStage({ token: (await validStage(committedRepository, "Committed")).token });
    const prior = await new ManagedProjectCatalogStore(committedRepository.config).get(committed.id);
    const trashed = await committedRepository.moveToTrash(committed.id, 1);
    const trashDirectory = join(committedRepository.config.trashRoot, committed.id);
    const committedIntentPath = join(committedRepository.config.recoveryRoot, `${committed.id}.json`);
    const identity = await directoryIdentity(trashDirectory);
    await writeFile(committedIntentPath, `${JSON.stringify({
      version: 2,
      operation: "trash",
      operationId: "operation_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      id: committed.id,
      expectedLifecycleRevision: 1,
      trashedAt: trashed.trashedAt,
      priorEntry: prior,
      sourceIdentity: identity,
      destinationIdentity: identity,
      phase: "catalog-trashed",
    }, null, 2)}\n`);

    await committedRepository.initialize();
    await expect(lstat(committedIntentPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(committedRepository.listTrash(1)).resolves.toMatchObject([{ id: committed.id }]);

    const conflictedRepository = await createRepository();
    const conflicted = await conflictedRepository.publishStage({ token: (await validStage(conflictedRepository, "Conflict")).token });
    const conflictEntry = await new ManagedProjectCatalogStore(conflictedRepository.config).get(conflicted.id);
    const conflictIntentPath = join(conflictedRepository.config.recoveryRoot, `${conflicted.id}.json`);
    await mkdir(join(conflictedRepository.config.trashRoot, conflicted.id));
    await writeFile(conflictIntentPath, `${JSON.stringify({
      version: 2,
      operation: "trash",
      operationId: "operation_cccccccccccccccccccccccccccccccc",
      id: conflicted.id,
      expectedLifecycleRevision: 1,
      trashedAt: "2026-07-19T00:00:00.000Z",
      priorEntry: conflictEntry,
      sourceIdentity: await directoryIdentity(conflicted.projectDirectory),
      destinationIdentity: null,
      phase: "prepared",
    }, null, 2)}\n`);

    await expect(conflictedRepository.initialize()).rejects.toThrow(/both active storage and Trash/i);
    await expect(lstat(conflictIntentPath)).resolves.toMatchObject({ isFile: expect.any(Function) });
    await expect(new ManagedProjectCatalogStore(conflictedRepository.config).get(conflicted.id))
      .resolves.toMatchObject({ lifecycle: "active" });
  });

  it("rejects forged destination identity and a non-derived committed catalog entry", async () => {
    const identityRepository = await createRepository();
    const identityProject = await identityRepository.publishStage({ token: (await validStage(identityRepository, "Identity")).token });
    const identityPrior = await new ManagedProjectCatalogStore(identityRepository.config).get(identityProject.id);
    const sourceIdentity = await directoryIdentity(identityProject.projectDirectory);
    const trashDirectory = join(identityRepository.config.trashRoot, identityProject.id);
    await rename(identityProject.projectDirectory, trashDirectory);
    const identityIntent = join(identityRepository.config.recoveryRoot, `${identityProject.id}.json`);
    await writeFile(identityIntent, `${JSON.stringify({
      version: 2,
      operation: "trash",
      operationId: "operation_dddddddddddddddddddddddddddddddd",
      id: identityProject.id,
      expectedLifecycleRevision: 1,
      trashedAt: "2026-07-19T00:00:00.000Z",
      priorEntry: identityPrior,
      sourceIdentity,
      destinationIdentity: { ...sourceIdentity, inode: "0" },
      phase: "directory-trashed",
    }, null, 2)}\n`);

    await expect(identityRepository.initialize()).rejects.toThrow(/destination identity/i);
    await expect(new ManagedProjectCatalogStore(identityRepository.config).get(identityProject.id))
      .resolves.toMatchObject({ lifecycle: "active" });
    await expect(lstat(identityIntent)).resolves.toMatchObject({ isFile: expect.any(Function) });

    const catalogRepository = await createRepository();
    const catalogProject = await catalogRepository.publishStage({ token: (await validStage(catalogRepository, "Catalog")).token });
    const catalogPrior = await new ManagedProjectCatalogStore(catalogRepository.config).get(catalogProject.id);
    const committed = await catalogRepository.moveToTrash(catalogProject.id, 1);
    const committedDirectory = join(catalogRepository.config.trashRoot, catalogProject.id);
    const committedIdentity = await directoryIdentity(committedDirectory);
    const catalogIntent = join(catalogRepository.config.recoveryRoot, `${catalogProject.id}.json`);
    await writeFile(catalogIntent, `${JSON.stringify({
      version: 2,
      operation: "trash",
      operationId: "operation_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      id: catalogProject.id,
      expectedLifecycleRevision: 1,
      trashedAt: committed.trashedAt,
      priorEntry: catalogPrior,
      sourceIdentity: committedIdentity,
      destinationIdentity: committedIdentity,
      phase: "catalog-trashed",
    }, null, 2)}\n`);
    const catalog = JSON.parse(await readFile(catalogRepository.config.catalogPath, "utf8")) as {
      entries: Array<{ name: string }>;
    };
    catalog.entries[0]!.name = "Forged name";
    await writeFile(catalogRepository.config.catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

    await expect(catalogRepository.initialize()).rejects.toThrow(/recovery state is inconsistent/i);
    await expect(lstat(catalogIntent)).resolves.toMatchObject({ isFile: expect.any(Function) });
  });

  it("leaves a pre-rename EXDEV failure recoverable without advancing the catalog", async () => {
    const root = await mkdtemp(join(tmpdir(), "managed-project-trash-exdev-"));
    temporaryRoots.push(root);
    const config = resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: root });
    const repository = new ManagedProjectRepository(config, {
      rename: async (from, to) => {
        if (from.includes("/projects/") && to.includes("/trash/")) {
          throw Object.assign(new Error("cross-device move rejected"), { code: "EXDEV" });
        }
        await rename(from, to);
      },
    });
    const published = await repository.publishStage({ token: (await validStage(repository, "EXDEV")).token });

    await expect(repository.moveToTrash(published.id, 1)).rejects.toThrow(/cross-device/i);
    const restarted = new ManagedProjectRepository(config);
    await restarted.initialize();
    await expect(restarted.open(published.id)).resolves.toMatchObject({ id: published.id });
    await expect(restarted.listTrash(1)).resolves.toEqual([]);
  });

  it.each([
    "after-directory-move",
    "before-catalog-transition",
    "after-catalog-transition",
    "after-catalog-journal",
    "after-session-invalidation",
    "before-intent-removal",
    "after-intent-removal",
  ] as const)("recovers deterministically after the %s boundary fails", async (failurePoint) => {
    const root = await mkdtemp(join(tmpdir(), `managed-project-trash-${failurePoint}-`));
    temporaryRoots.push(root);
    const config = resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: root });
    let injected = false;
    const repository = new ManagedProjectRepository(config, {
      trashFailpoint: async (point) => {
        if (!injected && point === failurePoint) {
          injected = true;
          throw new Error(`injected ${point} failure`);
        }
      },
      onTrashed: async () => {
        if (!injected && failurePoint === "after-catalog-journal") {
          // The explicit failpoint after the journal exercises callback ordering separately.
        }
      },
    });
    const published = await repository.publishStage({ token: (await validStage(repository, failurePoint)).token });

    await expect(repository.moveToTrash(published.id, 1)).rejects.toThrow(`injected ${failurePoint} failure`);
    const restarted = new ManagedProjectRepository(config);
    await restarted.initialize();
    await expect(restarted.list()).resolves.toEqual([]);
    await expect(restarted.listTrash(1)).resolves.toMatchObject([{ id: published.id, lifecycleRevision: 2 }]);
    await expect(lstat(join(config.recoveryRoot, `${published.id}.json`)))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("retries session invalidation after a post-commit callback failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "managed-project-trash-invalidation-"));
    temporaryRoots.push(root);
    const config = resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: root });
    const repository = new ManagedProjectRepository(config, {
      onTrashed: async () => { throw new Error("injected session invalidation failure"); },
    });
    const published = await repository.publishStage({ token: (await validStage(repository, "Invalidate")).token });

    await expect(repository.moveToTrash(published.id, 1)).rejects.toThrow(/session invalidation failure/i);
    let invalidations = 0;
    const restarted = new ManagedProjectRepository(config, {
      onTrashed: async () => { invalidations += 1; },
    });
    await restarted.initialize();
    expect(invalidations).toBe(1);
    await expect(restarted.listTrash(1)).resolves.toMatchObject([{ id: published.id }]);
  });

  it("keeps the committed Trash result when lifecycle-lock release reports failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "managed-project-trash-release-"));
    temporaryRoots.push(root);
    const config = resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: root });
    const repository = new ManagedProjectRepository(config, {
      acquireLifecycleLock: async (...arguments_) => {
        const lock = await acquireManagedProjectLifecycleLock(...arguments_);
        return {
          release: async () => {
            await lock.release();
            throw new Error("injected lifecycle release failure");
          },
        };
      },
    });
    const published = await repository.publishStage({ token: (await validStage(repository, "Release")).token });

    await expect(repository.moveToTrash(published.id, 1)).rejects.toThrow(/lifecycle release failure/i);
    const restarted = new ManagedProjectRepository(config);
    await restarted.initialize();
    await expect(restarted.listTrash(1)).resolves.toMatchObject([{ id: published.id }]);
    await expect(restarted.list()).resolves.toEqual([]);
  });

  it("rolls a published directory back to its owned stage when catalog insertion fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "managed-project-repository-"));
    temporaryRoots.push(root);
    const config = resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: root });
    const repository = new ManagedProjectRepository(config, {
      catalog: {
        read: async () => ({ version: 2, generation: 0, entries: [], lifecycleCommits: [] }),
        get: async () => undefined,
        list: async () => [],
        listTrashed: async () => [],
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
        read: async () => ({ version: 2, generation: 0, entries: [], lifecycleCommits: [] }),
        get: async () => undefined,
        list: async () => [],
        listTrashed: async () => [],
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
        read: async () => ({ version: 2, generation: 0, entries, lifecycleCommits: [] }),
        get: async (id) => entries.find((entry) => entry.id === id),
        list: async () => entries,
        listTrashed: async () => [],
        insert: async (entry) => { entries.push(entry); catalogEntry = entry; },
        removeActive: async () => { throw new Error("injected catalog rollback failure"); },
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
import { spawn, type ChildProcess } from "node:child_process";
