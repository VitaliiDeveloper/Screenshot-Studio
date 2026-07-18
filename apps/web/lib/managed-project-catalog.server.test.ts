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
import type { ManagedProjectCatalogEntry } from "./managed-project-catalog.server.js";
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

const temporaryRoots: string[] = [];

async function storageConfig(): Promise<ManagedProjectStorageConfig> {
  const root = await mkdtemp(join(tmpdir(), "managed-project-catalog-"));
  temporaryRoots.push(root);
  return resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: root });
}

function entry(id: string, name: string): ManagedProjectCatalogEntry {
  return {
    id,
    directoryName: id,
    name,
    lifecycle: "active",
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
      catalogPath: join(root, ".screenshot-studio", "catalog.json"),
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
  ])("rejects an invalid %s before filesystem access", (name, value) => {
    expect(() => resolveManagedProjectStorageConfig({ [name]: value })).toThrow(
      new RangeError(`${name} must be a positive integer`),
    );
  });
});

describe("parseManagedProjectCatalog", () => {
  it("accepts the version-one catalog contract and serializes entries deterministically", () => {
    const laterId = "project_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const catalog = parseManagedProjectCatalog({
      version: 1,
      entries: [catalogEntry({ id: laterId, directoryName: laterId }), catalogEntry()],
    });

    expect(catalog.entries).toHaveLength(2);
    expect(serializeManagedProjectCatalog(catalog)).toBe(`${JSON.stringify({
      version: 1,
      entries: [catalogEntry(), catalogEntry({ id: laterId, directoryName: laterId })],
    }, null, 2)}\n`);
  });

  it.each([
    ["a version mismatch", { version: 2, entries: [] }],
    ["a malformed timestamp", { version: 1, entries: [catalogEntry({ createdAt: "tomorrow" })] }],
    ["duplicate ids", { version: 1, entries: [catalogEntry(), catalogEntry()] }],
    ["an invalid directory name", { version: 1, entries: [catalogEntry({ directoryName: "other" })] }],
    ["an unknown lifecycle", { version: 1, entries: [catalogEntry({ lifecycle: "trashed" })] }],
    ["unknown top-level properties", { version: 1, entries: [], future: true }],
    ["unknown entry properties", { version: 1, entries: [catalogEntry({ future: true })] }],
  ])("rejects %s", (_description, value) => {
    expect(() => parseManagedProjectCatalog(value)).toThrow();
  });
});

describe("ManagedProjectCatalogStore", () => {
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
