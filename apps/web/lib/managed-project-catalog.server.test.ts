// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveManagedProjectStorageConfig } from "./managed-project-config.server.js";
import {
  parseManagedProjectCatalog,
  serializeManagedProjectCatalog,
  ManagedProjectCatalogStore,
} from "./managed-project-catalog.server.js";
import type { ActiveManagedProjectCatalogEntry } from "./managed-project-catalog.server.js";
import type { ManagedProjectStorageConfig } from "./managed-project-config.server.js";

const PROJECT_ID = "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function catalogEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    directoryName: PROJECT_ID,
    name: "Alpha",
    lifecycle: "active",
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    ...overrides,
  };
}

function activeCatalogEntry(overrides: Record<string, unknown> = {}) {
  return { ...catalogEntry(), lifecycleRevision: 1, ...overrides };
}

function trashedCatalogEntry(overrides: Record<string, unknown> = {}) {
  return {
    ...activeCatalogEntry(),
    lifecycle: "trashed",
    trashedAt: "2026-07-19T00:00:00.000Z",
    ...overrides,
  };
}

function purgeReceipt(overrides: Record<string, unknown> = {}) {
  return {
    operationId: "operation_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    operation: "purge",
    projectId: PROJECT_ID,
    lifecycleRevision: 2,
    ...overrides,
  };
}

const temporaryRoots: string[] = [];

async function storageConfig(): Promise<ManagedProjectStorageConfig> {
  const root = await mkdtemp(join(tmpdir(), "managed-project-catalog-"));
  temporaryRoots.push(root);
  return resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: root });
}

function entry(id: string, name: string): ActiveManagedProjectCatalogEntry {
  return {
    id,
    directoryName: id,
    name,
    lifecycle: "active",
    lifecycleRevision: 1,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("resolveManagedProjectStorageConfig", () => {
  it("uses the invocation directory for the default managed data root", () => {
    const root = "/workspace/invocation";

    expect(resolveManagedProjectStorageConfig({ INIT_CWD: root })).toMatchObject({
      root: join(root, ".screenshot-studio"),
      projectsRoot: join(root, ".screenshot-studio", "projects"),
      stagingRoot: join(root, ".screenshot-studio", "staging"),
      recoveryRoot: join(root, ".screenshot-studio", "recovery"),
      trashRoot: join(root, ".screenshot-studio", "trash"),
      tombstonesRoot: join(root, ".screenshot-studio", "tombstones"),
      lifecycleLocksRoot: join(root, ".screenshot-studio", "lifecycle-locks"),
      catalogPath: join(root, ".screenshot-studio", "catalog.json"),
      trashRetentionMs: null,
      trashRetentionBatchSize: 25,
    });
  });

  it("resolves a relative data root from the invocation directory", () => {
    expect(resolveManagedProjectStorageConfig({
      INIT_CWD: "/workspace/invocation",
      SCREENSHOT_STUDIO_DATA_ROOT: "runtime-data",
    }).root).toBe("/workspace/invocation/runtime-data");
  });

  it("keeps an absolute data root absolute", () => {
    expect(resolveManagedProjectStorageConfig({
      INIT_CWD: "/workspace/invocation",
      SCREENSHOT_STUDIO_DATA_ROOT: "/var/lib/screenshot-studio",
    }).root).toBe("/var/lib/screenshot-studio");
  });

  it.each([
    ["SCREENSHOT_STUDIO_MAX_PROJECT_FILES", "0"],
    ["SCREENSHOT_STUDIO_MAX_PROJECT_BYTES", "-1"],
    ["SCREENSHOT_STUDIO_STAGING_TTL_MS", "1.5"],
    ["SCREENSHOT_STUDIO_TRASH_RETENTION_MS", "0"],
    ["SCREENSHOT_STUDIO_TRASH_RETENTION_BATCH_SIZE", "-1"],
  ])("rejects an invalid %s before filesystem access", (name, value) => {
    expect(() => resolveManagedProjectStorageConfig({ [name]: value })).toThrow(
      new RangeError(`${name} must be a positive integer`),
    );
  });

  it("enables bounded retention only through explicit configuration", () => {
    expect(resolveManagedProjectStorageConfig({
      SCREENSHOT_STUDIO_TRASH_RETENTION_MS: "86400000",
      SCREENSHOT_STUDIO_TRASH_RETENTION_BATCH_SIZE: "7",
    })).toMatchObject({ trashRetentionMs: 86_400_000, trashRetentionBatchSize: 7 });
  });
});

describe("parseManagedProjectCatalog", () => {
  it("migrates the version-one catalog contract and serializes version two deterministically", () => {
    const laterId = "project_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const catalog = parseManagedProjectCatalog({
      version: 1,
      entries: [catalogEntry({ id: laterId, directoryName: laterId }), catalogEntry()],
    });

    expect(catalog).toMatchObject({ version: 2, generation: 0, lifecycleCommits: [] });
    expect(catalog.entries).toEqual([
      activeCatalogEntry({ id: laterId, directoryName: laterId }),
      activeCatalogEntry(),
    ]);
    expect(serializeManagedProjectCatalog(catalog)).toBe(`${JSON.stringify({
      version: 2,
      generation: 0,
      entries: [activeCatalogEntry(), activeCatalogEntry({ id: laterId, directoryName: laterId })],
      lifecycleCommits: [],
    }, null, 2)}\n`);
  });

  it("accepts strict active and trashed version-two entries", () => {
    expect(parseManagedProjectCatalog({
      version: 2,
      generation: 4,
      entries: [activeCatalogEntry(), trashedCatalogEntry({
        id: "project_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        directoryName: "project_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      })],
      lifecycleCommits: [{
        operationId: "operation_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        operation: "purge",
        projectId: "project_cccccccccccccccccccccccccccccccc",
        lifecycleRevision: 3,
      }],
    })).toMatchObject({ version: 2, generation: 4 });
  });

  it.each([
    ["a version mismatch", { version: 3, entries: [] }],
    ["a malformed timestamp", { version: 1, entries: [catalogEntry({ createdAt: "tomorrow" })] }],
    ["duplicate ids", { version: 1, entries: [catalogEntry(), catalogEntry()] }],
    ["an invalid directory name", { version: 1, entries: [catalogEntry({ directoryName: "other" })] }],
    ["an unknown lifecycle", { version: 1, entries: [catalogEntry({ lifecycle: "trashed" })] }],
    ["unknown top-level properties", { version: 1, entries: [], future: true }],
    ["unknown entry properties", { version: 1, entries: [catalogEntry({ future: true })] }],
    ["a negative generation", { version: 2, generation: -1, entries: [], lifecycleCommits: [] }],
    ["a zero lifecycle revision", { version: 2, generation: 0, entries: [activeCatalogEntry({ lifecycleRevision: 0 })], lifecycleCommits: [] }],
    ["a trashed entry without trashedAt", { version: 2, generation: 0, entries: [activeCatalogEntry({ lifecycle: "trashed" })], lifecycleCommits: [] }],
    ["an active entry with trashedAt", { version: 2, generation: 0, entries: [activeCatalogEntry({ trashedAt: "2026-07-19T00:00:00.000Z" })], lifecycleCommits: [] }],
    ["a malformed lifecycle receipt", { version: 2, generation: 0, entries: [], lifecycleCommits: [{ operationId: "bad" }] }],
    ["a purge receipt for a live entry", { version: 2, generation: 0, entries: [trashedCatalogEntry()], lifecycleCommits: [purgeReceipt()] }],
    ["multiple purge receipts for one project", {
      version: 2,
      generation: 0,
      entries: [],
      lifecycleCommits: [
        purgeReceipt(),
        purgeReceipt({ operationId: "operation_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", lifecycleRevision: 3 }),
      ],
    }],
  ])("rejects %s", (_description, value) => {
    expect(() => parseManagedProjectCatalog(value)).toThrow();
  });
});

describe("ManagedProjectCatalogStore", () => {
  it("atomically persists a version-one migration on first read", async () => {
    const config = await storageConfig();
    await writeFile(config.catalogPath, `${JSON.stringify({ version: 1, entries: [catalogEntry()] })}\n`);

    await expect(new ManagedProjectCatalogStore(config).read()).resolves.toMatchObject({ version: 2 });
    await expect(readFile(config.catalogPath, "utf8")).resolves.toContain('"version": 2');
  });

  it("initializes an empty catalog and reloads it after a restart", async () => {
    const config = await storageConfig();
    const first = new ManagedProjectCatalogStore(config);

    await expect(first.list()).resolves.toEqual([]);
    await first.insert(entry(PROJECT_ID, "Alpha"));

    await expect(new ManagedProjectCatalogStore(config).get(PROJECT_ID)).resolves.toMatchObject({
      id: PROJECT_ID,
      name: "Alpha",
    });
  });

  it("rejects duplicate ids", async () => {
    const store = new ManagedProjectCatalogStore(await storageConfig());
    await store.insert(entry(PROJECT_ID, "Alpha"));

    await expect(store.insert(entry(PROJECT_ID, "Again"))).rejects.toThrow(/duplicate/i);
  });

  it("does not reuse a project id that has terminal purge evidence", async () => {
    const config = await storageConfig();
    const persisted = `${JSON.stringify({
      version: 2,
      generation: 1,
      entries: [],
      lifecycleCommits: [purgeReceipt()],
    }, null, 2)}\n`;
    await writeFile(config.catalogPath, persisted);

    await expect(new ManagedProjectCatalogStore(config).insert(entry(PROJECT_ID, "Reused")))
      .rejects.toThrow(/purge/i);
    await expect(readFile(config.catalogPath, "utf8")).resolves.toBe(persisted);
  });

  it("preserves both entries from concurrent inserts", async () => {
    const store = new ManagedProjectCatalogStore(await storageConfig());
    const alpha = "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const beta = "project_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    await Promise.all([
      store.insert(entry(alpha, "Alpha")),
      store.insert(entry(beta, "Beta")),
    ]);

    await expect(store.list()).resolves.toMatchObject([
      { id: alpha, name: "Alpha" },
      { id: beta, name: "Beta" },
    ]);
  });

  it("filters active lookups and returns a bounded newest-first Trash list", async () => {
    const store = new ManagedProjectCatalogStore(await storageConfig());
    const alpha = entry(PROJECT_ID, "Alpha");
    const betaId = "project_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const gammaId = "project_cccccccccccccccccccccccccccccccc";
    await store.insert(alpha);
    await store.insert(entry(betaId, "Beta"));
    await store.insert(entry(gammaId, "Gamma"));
    await store.transitionToTrashed(betaId, 1, "2026-07-19T00:00:00.000Z");
    await store.transitionToTrashed(gammaId, 1, "2026-07-20T00:00:00.000Z");

    await expect(store.getActive(betaId)).resolves.toBeUndefined();
    await expect(store.listActive()).resolves.toEqual([alpha]);
    await expect(store.listTrashed(1)).resolves.toMatchObject([{
      id: gammaId,
      lifecycle: "trashed",
      lifecycleRevision: 2,
    }]);
    await expect(store.listTrashed(0)).rejects.toThrow(/positive integer/i);
    await expect(store.listTrashed(101)).rejects.toThrow(/at most 100/i);
  });

  it("rejects a stale lifecycle transition without substituting the latest revision", async () => {
    const store = new ManagedProjectCatalogStore(await storageConfig());
    await store.insert(entry(PROJECT_ID, "Alpha"));

    await expect(store.transitionToTrashed(PROJECT_ID, 2, "2026-07-19T00:00:00.000Z"))
      .rejects.toThrow(/lifecycle revision/i);
    await expect(store.getActive(PROJECT_ID)).resolves.toMatchObject({ lifecycleRevision: 1 });
  });

  it("removes a trashed entry and records the operation receipt in one catalog write", async () => {
    const store = new ManagedProjectCatalogStore(await storageConfig());
    await store.insert(entry(PROJECT_ID, "Alpha"));
    await store.transitionToTrashed(PROJECT_ID, 1, "2026-07-19T00:00:00.000Z");

    await store.removeTrashedWithReceipt(PROJECT_ID, 2, {
      operationId: "operation_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      operation: "purge",
      projectId: PROJECT_ID,
      lifecycleRevision: 2,
    });

    await expect(store.get(PROJECT_ID)).resolves.toBeUndefined();
    await expect(store.read()).resolves.toMatchObject({
      lifecycleCommits: [{ operationId: "operation_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }],
    });
  });

  it("never lets publication rollback remove a trashed or stale entry", async () => {
    const store = new ManagedProjectCatalogStore(await storageConfig());
    await store.insert(entry(PROJECT_ID, "Alpha"));
    await store.transitionToTrashed(PROJECT_ID, 1, "2026-07-19T00:00:00.000Z");

    await expect(store.removeActive(PROJECT_ID, 1)).rejects.toThrow(/active/i);
    await expect(store.get(PROJECT_ID)).resolves.toMatchObject({ lifecycle: "trashed" });
  });

  it("rejects generation and lifecycle revision overflow before changing catalog bytes", async () => {
    const config = await storageConfig();
    const maximum = Number.MAX_SAFE_INTEGER;
    await writeFile(config.catalogPath, serializeManagedProjectCatalog({
      version: 2,
      generation: maximum,
      entries: [],
      lifecycleCommits: [],
    }));
    const generationBytes = await readFile(config.catalogPath, "utf8");
    await expect(new ManagedProjectCatalogStore(config).insert(entry(PROJECT_ID, "Alpha")))
      .rejects.toThrow(/generation/i);
    await expect(readFile(config.catalogPath, "utf8")).resolves.toBe(generationBytes);

    await writeFile(config.catalogPath, serializeManagedProjectCatalog({
      version: 2,
      generation: 1,
      entries: [{ ...entry(PROJECT_ID, "Alpha"), lifecycleRevision: maximum }],
      lifecycleCommits: [],
    }));
    const lifecycleBytes = await readFile(config.catalogPath, "utf8");
    await expect(new ManagedProjectCatalogStore(config).transitionToTrashed(
      PROJECT_ID,
      maximum,
      "2026-07-19T00:00:00.000Z",
    )).rejects.toThrow(/lifecycle revision/i);
    await expect(readFile(config.catalogPath, "utf8")).resolves.toBe(lifecycleBytes);
  });

  it("keeps the previous catalog bytes when staging a write fails", async () => {
    const config = await storageConfig();
    const stable = new ManagedProjectCatalogStore(config);
    await stable.insert(entry(PROJECT_ID, "Alpha"));
    const previous = await readFile(config.catalogPath, "utf8");
    const failing = new ManagedProjectCatalogStore(config, {
      writeStageFile: async () => { throw new Error("injected stage-write failure"); },
    });

    await expect(failing.insert(entry("project_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "Beta"))).rejects.toThrow(
      "injected stage-write failure",
    );
    await expect(readFile(config.catalogPath, "utf8")).resolves.toBe(previous);
    await expect(failing.list()).resolves.toMatchObject([{ id: PROJECT_ID, name: "Alpha" }]);
  });

  it("keeps the previous readable catalog when rename fails", async () => {
    const config = await storageConfig();
    const stable = new ManagedProjectCatalogStore(config);
    await stable.insert(entry(PROJECT_ID, "Alpha"));
    const failing = new ManagedProjectCatalogStore(config, {
      rename: async () => { throw new Error("injected rename failure"); },
    });

    await expect(failing.insert(entry("project_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "Beta"))).rejects.toThrow(
      "injected rename failure",
    );
    await expect(new ManagedProjectCatalogStore(config).list()).resolves.toMatchObject([
      { id: PROJECT_ID, name: "Alpha" },
    ]);
  });

  it("fails closed on corrupt catalog bytes", async () => {
    const config = await storageConfig();
    const store = new ManagedProjectCatalogStore(config);
    await store.list();
    await writeFile(config.catalogPath, "not JSON");

    await expect(new ManagedProjectCatalogStore(config).list()).rejects.toThrow();
  });
});
