// SPDX-License-Identifier: Apache-2.0
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveManagedProjectStorageConfig } from "./managed-project-config.server.js";
import { acquireManagedProjectLifecycleLock } from "./managed-project-lifecycle-lock.server.js";
import {
  parseManagedProjectCatalog,
  serializeManagedProjectCatalog,
  ManagedProjectCatalogStore,
} from "./managed-project-catalog.server.js";
import type { ActiveManagedProjectCatalogEntry } from "./managed-project-catalog.server.js";
import type { ManagedProjectStorageConfig } from "./managed-project-config.server.js";

const PROJECT_ID = "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ID_NAMESPACE = "1234567890abcdef";
const PROJECT_REVISION = "1".repeat(64);
const STATUS_SECRET_HASH = "2".repeat(64);

function catalogEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    directoryName: PROJECT_ID,
    name: "Alpha",
    lifecycle: "active" as const,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    ...overrides,
  };
}

function activeCatalogEntry(overrides: Record<string, unknown> = {}) {
  return { ...catalogEntry(), lifecycleRevision: 1, ...overrides };
}

function catalogDocument(overrides: Record<string, unknown> = {}) {
  return {
    version: 1 as const,
    generation: 0,
    idNamespace: ID_NAMESPACE,
    nextProjectOrdinal: 1,
    entries: [],
    deletions: [],
    ...overrides,
  };
}

function deletionReservation(overrides: Record<string, unknown> = {}) {
  return {
    operationId: "operation_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    operation: "delete" as const,
    state: "reserved" as const,
    projectId: PROJECT_ID,
    lifecycleRevision: 1,
    statusSecretHash: STATUS_SECRET_HASH,
    projectRevision: PROJECT_REVISION,
    priorEntry: activeCatalogEntry(),
    sourceIdentity: { device: "1", inode: "2" },
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
      tombstonesRoot: join(root, ".screenshot-studio", "tombstones"),
      lifecycleLocksRoot: join(root, ".screenshot-studio", "lifecycle-locks"),
      catalogPath: join(root, ".screenshot-studio", "catalog.json"),
    });
    expect(resolveManagedProjectStorageConfig({ INIT_CWD: root })).not.toHaveProperty("trashRoot");
    expect(resolveManagedProjectStorageConfig({ INIT_CWD: root })).not.toHaveProperty("trashRetentionMs");
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
  ])("rejects an invalid %s before filesystem access", (name, value) => {
    expect(() => resolveManagedProjectStorageConfig({ [name]: value })).toThrow(
      new RangeError(`${name} must be a positive integer`),
    );
  });

  it("does not accept user-visible Trash retention configuration", () => {
    const config = resolveManagedProjectStorageConfig({
      SCREENSHOT_STUDIO_TRASH_RETENTION_MS: "86400000",
      SCREENSHOT_STUDIO_TRASH_RETENTION_BATCH_SIZE: "7",
    } as never);
    expect(config).not.toHaveProperty("trashRetentionMs");
    expect(config).not.toHaveProperty("trashRetentionBatchSize");
  });
});

describe("parseManagedProjectCatalog", () => {
  it("parses and serializes the strict version-one catalog deterministically", () => {
    const laterId = "project_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const catalog = parseManagedProjectCatalog(catalogDocument({
      entries: [
        activeCatalogEntry({ id: laterId, directoryName: laterId }),
        activeCatalogEntry(),
      ],
    }));

    expect(catalog).toMatchObject({
      version: 1,
      generation: 0,
      idNamespace: ID_NAMESPACE,
      nextProjectOrdinal: 1,
      deletions: [],
    });
    expect(catalog.entries).toEqual([
      activeCatalogEntry({ id: laterId, directoryName: laterId }),
      activeCatalogEntry(),
    ]);
    expect(serializeManagedProjectCatalog(catalog)).toBe(`${JSON.stringify({
      version: 1,
      generation: 0,
      idNamespace: ID_NAMESPACE,
      nextProjectOrdinal: 1,
      entries: [activeCatalogEntry(), activeCatalogEntry({ id: laterId, directoryName: laterId })],
      deletions: [],
    }, null, 2)}\n`);
  });

  it("rejects the unshipped long-lived trashed catalog state", () => {
    expect(() => parseManagedProjectCatalog(catalogDocument({
      entries: [activeCatalogEntry(), activeCatalogEntry({
        id: "project_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        directoryName: "project_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        lifecycle: "trashed",
        trashedAt: "2026-07-19T00:00:00.000Z",
      })],
    }))).toThrow(/unknown|lifecycle/i);
  });

  it.each([
    ["a version mismatch", catalogDocument({ version: 2 })],
    ["the incomplete pre-release version-one shape", { version: 1, entries: [] }],
    ["the abandoned lifecycle shape", {
      version: 2, generation: 0, entries: [], lifecycleCommits: [],
    }],
    ["a malformed timestamp", catalogDocument({
      entries: [activeCatalogEntry({ createdAt: "tomorrow" })],
    })],
    ["duplicate ids", catalogDocument({ entries: [activeCatalogEntry(), activeCatalogEntry()] })],
    ["an invalid directory name", catalogDocument({
      entries: [activeCatalogEntry({ directoryName: "other" })],
    })],
    ["an unknown lifecycle", catalogDocument({
      entries: [activeCatalogEntry({ lifecycle: "trashed" })],
    })],
    ["unknown top-level properties", catalogDocument({ future: true })],
    ["unknown entry properties", catalogDocument({
      entries: [activeCatalogEntry({ future: true })],
    })],
    ["a negative generation", catalogDocument({ generation: -1 })],
    ["an invalid id namespace", catalogDocument({ idNamespace: "not-opaque" })],
    ["a zero next ordinal", catalogDocument({ nextProjectOrdinal: 0 })],
    ["a next ordinal that can reuse a known id", catalogDocument({
      nextProjectOrdinal: 1,
      entries: [activeCatalogEntry({
        id: "project_1234567890abcdef0000000000000001",
        directoryName: "project_1234567890abcdef0000000000000001",
      })],
    })],
    ["a zero lifecycle revision", catalogDocument({ entries: [activeCatalogEntry({ lifecycleRevision: 0 })] })],
    ["a malformed deletion record", catalogDocument({ deletions: [{ operationId: "bad" }] })],
    ["a reservation without its live entry", catalogDocument({ deletions: [deletionReservation()] })],
    ["a reservation whose prior entry differs from the live entry", catalogDocument({
      entries: [activeCatalogEntry()],
      deletions: [deletionReservation({ priorEntry: activeCatalogEntry({ name: "Forged" }) })],
    })],
    ["a terminal record for a live entry", catalogDocument({
      entries: [activeCatalogEntry()],
      deletions: [{
        operationId: "operation_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        operation: "delete",
        state: "cleanup-pending",
        projectId: PROJECT_ID,
        lifecycleRevision: 1,
        statusSecretHash: STATUS_SECRET_HASH,
      }],
    })],
    ["multiple deletion records for one project", catalogDocument({
      deletions: [
        { ...deletionReservation(), state: "cleanup-pending" },
        {
          ...deletionReservation({ operationId: "operation_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
          state: "cleanup-pending",
        },
      ],
    })],
  ])("rejects %s", (_description, value) => {
    expect(() => parseManagedProjectCatalog(value)).toThrow();
  });
});

describe("ManagedProjectCatalogStore", () => {
  it("atomically reserves monotonic opaque project ids without reuse", async () => {
    const store = new ManagedProjectCatalogStore(await storageConfig(), {
      createIdNamespace: () => "1234567890abcdef",
    });

    await expect(store.reserveProjectId()).resolves.toBe(
      "project_1234567890abcdef0000000000000001",
    );
    await expect(store.reserveProjectId()).resolves.toBe(
      "project_1234567890abcdef0000000000000002",
    );
    await expect(store.read()).resolves.toMatchObject({
      idNamespace: "1234567890abcdef",
      nextProjectOrdinal: 3,
    });
  });

  it("preserves every ordinal across concurrent reservations from independent stores", async () => {
    const config = await storageConfig();
    const first = new ManagedProjectCatalogStore(config, { createIdNamespace: () => ID_NAMESPACE });
    const second = new ManagedProjectCatalogStore(config, { createIdNamespace: () => ID_NAMESPACE });

    const ids = await Promise.all(Array.from({ length: 40 }, (_, index) =>
      (index % 2 === 0 ? first : second).reserveProjectId()));

    expect(new Set(ids).size).toBe(40);
    expect([...ids].sort()).toEqual(Array.from({ length: 40 }, (_, index) =>
      `project_${ID_NAMESPACE}${(index + 1).toString(16).padStart(16, "0")}`));
    await expect(first.read()).resolves.toMatchObject({ nextProjectOrdinal: 41 });
  });

  it("rejects a symlinked configured root before creating catalog state in its target", async () => {
    const container = await mkdtemp(join(tmpdir(), "managed-project-catalog-root-"));
    temporaryRoots.push(container);
    const outside = join(container, "outside");
    const declared = join(container, "declared");
    await mkdir(outside);
    await symlink(outside, declared);
    const config = resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: declared });

    await expect(new ManagedProjectCatalogStore(config).read()).rejects.toThrow(/storage root/i);
    await expect(readdir(outside)).resolves.toEqual([]);
  });

  it.each([
    ["an incomplete pre-release version-one catalog", `${JSON.stringify({
      version: 1,
      entries: [catalogEntry()],
    })}\n`],
    ["a complete version-two catalog", `${JSON.stringify({
      ...catalogDocument(),
      version: 2,
    })}\n`],
    ["the abandoned lifecycle catalog", `${JSON.stringify({
      version: 2,
      generation: 0,
      entries: [],
      lifecycleCommits: [],
    })}\n`],
    ["malformed JSON", "not JSON"],
  ])("rejects %s without rewriting persisted bytes", async (_case, persisted) => {
    const config = await storageConfig();
    await writeFile(config.catalogPath, persisted);

    await expect(new ManagedProjectCatalogStore(config).read()).rejects.toThrow();
    await expect(readFile(config.catalogPath, "utf8")).resolves.toBe(persisted);
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

  it("does not accept an inserted project id that has deletion evidence", async () => {
    const config = await storageConfig();
    const persisted = `${JSON.stringify({
      ...catalogDocument({ generation: 1 }),
      deletions: [{
        operationId: "operation_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        operation: "delete",
        state: "complete",
        projectId: PROJECT_ID,
        lifecycleRevision: 1,
        statusSecretHash: STATUS_SECRET_HASH,
        projectRevision: PROJECT_REVISION,
        completedAt: "2026-07-19T00:00:00.000Z",
      }],
    }, null, 2)}\n`;
    await writeFile(config.catalogPath, persisted);

    await expect(new ManagedProjectCatalogStore(config).insert(entry(PROJECT_ID, "Reused")))
      .rejects.toThrow(/deletion/i);
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

  it("atomically reserves deletion and immediately hides the project from active lookups", async () => {
    const store = new ManagedProjectCatalogStore(await storageConfig());
    await store.insert(entry(PROJECT_ID, "Alpha"));

    await expect(store.reserveDeletion(deletionReservation())).resolves.toMatchObject({
      operationId: "operation_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      state: "reserved",
    });

    await expect(store.getActive(PROJECT_ID)).resolves.toBeUndefined();
    await expect(store.listActive()).resolves.toEqual([]);
    await expect(store.getDeletionEvidence("operation_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"))
      .resolves.toMatchObject({ projectId: PROJECT_ID, state: "reserved" });
  });

  it("rejects stale or mismatched deletion reservations without changing catalog bytes", async () => {
    const store = new ManagedProjectCatalogStore(await storageConfig());
    await store.insert(entry(PROJECT_ID, "Alpha"));
    const before = serializeManagedProjectCatalog(await store.read());

    await expect(store.reserveDeletion(deletionReservation({
      lifecycleRevision: 2,
      priorEntry: activeCatalogEntry({ lifecycleRevision: 2 }),
    })))
      .rejects.toThrow(/lifecycle revision/i);
    await expect(store.reserveDeletion(deletionReservation({ projectRevision: "bad" })))
      .rejects.toThrow(/project revision/i);
    expect(serializeManagedProjectCatalog(await store.read())).toBe(before);
    await expect(store.getActive(PROJECT_ID)).resolves.toMatchObject({ lifecycleRevision: 1 });
  });

  it("commits deletion admission as non-evictable cleanup-pending evidence", async () => {
    const store = new ManagedProjectCatalogStore(await storageConfig());
    await store.insert(entry(PROJECT_ID, "Alpha"));
    await store.reserveDeletion(deletionReservation());

    await expect(store.commitDeletion("operation_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"))
      .resolves.toMatchObject({ state: "cleanup-pending", projectId: PROJECT_ID });

    await expect(store.get(PROJECT_ID)).resolves.toBeUndefined();
    await expect(store.getDeletionEvidence("operation_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"))
      .resolves.toMatchObject({ state: "cleanup-pending" });
    expect(store).not.toHaveProperty("completeDeletion");
  });

  it("completes pending evidence only with its held lifecycle lease after intent removal", async () => {
    const config = await storageConfig();
    const store = new ManagedProjectCatalogStore(config);
    await store.insert(entry(PROJECT_ID, "Alpha"));
    await store.reserveDeletion(deletionReservation());
    await store.commitDeletion("operation_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    await mkdir(config.recoveryRoot, { recursive: true });
    const intentPath = join(config.recoveryRoot, `${PROJECT_ID}.json`);
    await writeFile(intentPath, "{}\n");
    const lease = await acquireManagedProjectLifecycleLock(config, PROJECT_ID);
    const forgedLease = { projectId: PROJECT_ID, release: async () => undefined };

    await expect(store.completeDeletionAfterIntentRemoval(
      "operation_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "2026-07-19T00:00:00.000Z",
      forgedLease,
    )).rejects.toThrow(/lifecycle lock must be held/i);

    await expect(store.completeDeletionAfterIntentRemoval(
      "operation_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "2026-07-19T00:00:00.000Z",
      lease,
    )).rejects.toThrow(/recovery intent/i);
    await rm(intentPath);
    await expect(store.completeDeletionAfterIntentRemoval(
      "operation_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "2026-07-19T00:00:00.000Z",
      lease,
    )).resolves.toMatchObject({ state: "complete" });
    await lease.release();
    await expect(store.completeDeletionAfterIntentRemoval(
      "operation_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "2026-07-19T00:00:00.000Z",
      lease,
    )).rejects.toThrow(/lifecycle lock must be held/i);
  });

  it("evicts only the oldest completed status when the 257th operation completes", async () => {
    const config = await storageConfig();
    const completed = Array.from({ length: 256 }, (_, index) => ({
      operationId: `operation_${index.toString(16).padStart(32, "0")}`,
      operation: "delete" as const,
      state: "complete" as const,
      projectId: `project_${index.toString(16).padStart(32, "0")}`,
      lifecycleRevision: 1,
      statusSecretHash: STATUS_SECRET_HASH,
      projectRevision: PROJECT_REVISION,
      completedAt: new Date(index * 1_000).toISOString(),
    }));
    const operationId = `operation_${"f".repeat(32)}`;
    const projectId = `project_${"f".repeat(32)}`;
    await writeFile(config.catalogPath, serializeManagedProjectCatalog(catalogDocument({
      deletions: [...completed, {
        operationId,
        operation: "delete",
        state: "cleanup-pending",
        projectId,
        lifecycleRevision: 1,
        statusSecretHash: STATUS_SECRET_HASH,
        projectRevision: PROJECT_REVISION,
        sourceIdentity: { device: "1", inode: "999" },
      }],
    })));
    await mkdir(config.recoveryRoot, { recursive: true });
    const store = new ManagedProjectCatalogStore(config);
    const lease = await acquireManagedProjectLifecycleLock(config, projectId);

    await store.completeDeletionAfterIntentRemoval(operationId, new Date(256_000).toISOString(), lease);
    await lease.release();

    const evidence = (await store.read()).deletions;
    expect(evidence).toHaveLength(256);
    expect(evidence).toContainEqual(expect.objectContaining({ operationId, state: "complete" }));
    expect(evidence).not.toContainEqual(expect.objectContaining({
      operationId: "operation_00000000000000000000000000000000",
    }));
  });

  it("rejects new admission at the pending-operation bound without changing catalog bytes", async () => {
    const config = await storageConfig();
    const pending = Array.from({ length: 1_000 }, (_, index) => ({
      operationId: `operation_${index.toString(16).padStart(32, "0")}`,
      operation: "delete" as const,
      state: "cleanup-pending" as const,
      projectId: `project_${index.toString(16).padStart(32, "0")}`,
      lifecycleRevision: 1,
      statusSecretHash: STATUS_SECRET_HASH,
      projectRevision: PROJECT_REVISION,
      sourceIdentity: { device: "1", inode: String(index + 1) },
    }));
    await writeFile(config.catalogPath, serializeManagedProjectCatalog(catalogDocument({
      entries: [activeCatalogEntry()],
      deletions: pending,
    })));
    const before = await readFile(config.catalogPath, "utf8");

    await expect(new ManagedProjectCatalogStore(config).reserveDeletion(deletionReservation()))
      .rejects.toThrow(/pending deletion limit/i);
    await expect(readFile(config.catalogPath, "utf8")).resolves.toBe(before);
  });

  it("admits exactly one operation when two stores race for the final pending slot", async () => {
    const config = await storageConfig();
    const pending = Array.from({ length: 999 }, (_, index) => ({
      operationId: `operation_${index.toString(16).padStart(32, "0")}`,
      operation: "delete" as const,
      state: "cleanup-pending" as const,
      projectId: `project_${index.toString(16).padStart(32, "0")}`,
      lifecycleRevision: 1,
      statusSecretHash: STATUS_SECRET_HASH,
      projectRevision: PROJECT_REVISION,
      sourceIdentity: { device: "1", inode: String(index + 1) },
    }));
    const betaId = "project_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    await writeFile(config.catalogPath, serializeManagedProjectCatalog(catalogDocument({
      entries: [activeCatalogEntry(), activeCatalogEntry({
        id: betaId,
        directoryName: betaId,
        name: "Beta",
      })],
      deletions: pending,
    })));
    const first = new ManagedProjectCatalogStore(config);
    const second = new ManagedProjectCatalogStore(config);

    const results = await Promise.allSettled([
      first.reserveDeletion(deletionReservation()),
      second.reserveDeletion(deletionReservation({
        operationId: "operation_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        projectId: betaId,
        priorEntry: activeCatalogEntry({ id: betaId, directoryName: betaId, name: "Beta" }),
      })),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await first.read()).deletions.filter((record) => record.state !== "complete"))
      .toHaveLength(1_000);
  });

  it("keeps the allocator high-water mark after the oldest completed evidence is evicted", async () => {
    const config = await storageConfig();
    const completed = Array.from({ length: 256 }, (_, index) => ({
      operationId: `operation_${(index + 2).toString(16).padStart(32, "0")}`,
      operation: "delete" as const,
      state: "complete" as const,
      projectId: `project_${ID_NAMESPACE}${(index + 2).toString(16).padStart(16, "0")}`,
      lifecycleRevision: 1,
      statusSecretHash: STATUS_SECRET_HASH,
      projectRevision: PROJECT_REVISION,
      completedAt: new Date(index * 1_000).toISOString(),
    }));
    await writeFile(config.catalogPath, serializeManagedProjectCatalog(catalogDocument({
      nextProjectOrdinal: 258,
      deletions: completed,
    })));

    await expect(new ManagedProjectCatalogStore(config).reserveProjectId()).resolves.toBe(
      `project_${ID_NAMESPACE}0000000000000102`,
    );
  });

  it("never lets publication rollback remove a deletion-reserved entry", async () => {
    const store = new ManagedProjectCatalogStore(await storageConfig());
    await store.insert(entry(PROJECT_ID, "Alpha"));
    await store.reserveDeletion(deletionReservation());

    await expect(store.removeActive(PROJECT_ID, 1)).rejects.toThrow(/deletion/i);
    await expect(store.read()).resolves.toMatchObject({ entries: [{ id: PROJECT_ID }] });
  });

  it("rejects generation and id ordinal overflow before changing catalog bytes", async () => {
    const config = await storageConfig();
    const maximum = Number.MAX_SAFE_INTEGER;
    await writeFile(config.catalogPath, serializeManagedProjectCatalog(catalogDocument({
      generation: maximum,
    })));
    const generationBytes = await readFile(config.catalogPath, "utf8");
    await expect(new ManagedProjectCatalogStore(config).insert(entry(PROJECT_ID, "Alpha")))
      .rejects.toThrow(/generation/i);
    await expect(readFile(config.catalogPath, "utf8")).resolves.toBe(generationBytes);

    await writeFile(config.catalogPath, serializeManagedProjectCatalog(catalogDocument({
      generation: 1,
      nextProjectOrdinal: maximum,
    })));
    const ordinalBytes = await readFile(config.catalogPath, "utf8");
    await expect(new ManagedProjectCatalogStore(config).reserveProjectId())
      .rejects.toThrow(/ordinal/i);
    await expect(readFile(config.catalogPath, "utf8")).resolves.toBe(ordinalBytes);
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

});
