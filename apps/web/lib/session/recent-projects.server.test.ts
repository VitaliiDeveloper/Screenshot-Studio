// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagedProjectCatalogStore } from "@web/lib/managed-projects/managed-project-catalog.server.js";
import { resolveManagedProjectStorageConfig } from "@web/lib/managed-projects/managed-project-config.server.js";
import {
  MAX_RECENT_PROJECTS,
  RecentProjectsStore,
  parseRecentProjectsDocument,
} from "./recent-projects.server.js";
import type { ProjectSession, ProjectSessionRegistry } from "./project-session.server.js";

const roots: string[] = [];

async function config() {
  const root = await mkdtemp(join(tmpdir(), "recent-projects-"));
  roots.push(root);
  return resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: root });
}

function managedSession(index: number, name = `Project ${index}`): ProjectSession {
  const projectId = `project_${index.toString(16).padStart(32, "0")}`;
  return {
    projectId,
    projectPath: `/private/managed/${projectId}/app-store-screenshots.json`,
    descriptor: {
      sessionId: `session-${index}`,
      name,
      sourceKind: "managed-project",
      lifecycleRevision: 1,
      capabilities: {
        writeInPlace: true,
        revealLocation: false,
        watchExternalChanges: false,
        nativePicker: false,
        projectLocalResources: true,
        exportProjectArchive: true,
        deleteProjectPermanently: true,
      },
    },
  };
}

function activeEntry(index: number, name = `Project ${index}`) {
  const session = managedSession(index, name);
  return {
    id: session.projectId,
    directoryName: session.projectId,
    name,
    lifecycle: "active" as const,
    lifecycleRevision: 1,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  };
}

function localSession(index: number, path = `/Users/alex/private-${index}/app-store-screenshots.json`): ProjectSession {
  return {
    projectId: `${index}`.repeat(64).slice(0, 64),
    projectPath: path,
    descriptor: {
      sessionId: `local-session-${index}`,
      name: `Local ${index}`,
      sourceKind: "local-file",
      displayLocation: path,
      capabilities: {
        writeInPlace: true,
        revealLocation: true,
        watchExternalChanges: true,
        nativePicker: false,
        projectLocalResources: true,
        exportProjectArchive: false,
        deleteProjectPermanently: false,
      },
    },
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("RecentProjectsStore", () => {
  it("keeps recent-history and catalog locks isolated when their mutations overlap", async () => {
    const storage = await config();
    let enterHistoryRead!: () => void;
    const historyReadStarted = new Promise<void>((resolve) => { enterHistoryRead = resolve; });
    let resumeHistoryRead!: () => void;
    const historyReadMayContinue = new Promise<void>((resolve) => { resumeHistoryRead = resolve; });
    const store = new RecentProjectsStore(storage, {
      catalog: { listActive: vi.fn(async () => []) },
      validateManaged: vi.fn(),
      validateLocal: vi.fn(),
      openFile: async (path, flags, mode) => {
        if (path === join(storage.root, "recent-projects.json")) {
          enterHistoryRead();
          await historyReadMayContinue;
        }
        return open(path, flags, mode);
      },
    });

    const recentMutation = store.list();
    await historyReadStarted;
    await new ManagedProjectCatalogStore(storage).insert(activeEntry(1));
    resumeHistoryRead();

    await expect(recentMutation).resolves.toEqual({ entries: [] });
  });

  it("takes the catalog recovery snapshot before entering recent-history file access", async () => {
    const storage = await config();
    let catalogReadCompleted = false;
    const store = new RecentProjectsStore(storage, {
      catalog: {
        listActive: vi.fn(async () => {
          catalogReadCompleted = true;
          return [];
        }),
      },
      validateManaged: vi.fn(),
      validateLocal: vi.fn(),
      openFile: async (path, flags, mode) => {
        if (path === join(storage.root, "recent-projects.json")) {
          expect(catalogReadCompleted).toBe(true);
        }
        return open(path, flags, mode);
      },
    });

    await expect(store.list()).resolves.toEqual({ entries: [] });
  });

  it("persists, deduplicates, orders, and deterministically bounds successful opens across restarts", async () => {
    const storage = await config();
    let ordinal = 0;
    let minute = 0;
    const dependencies = {
      createRecentId: () => `recent_${(++ordinal).toString(16).padStart(32, "0")}`,
      now: () => new Date(Date.UTC(2026, 6, 20, 12, minute++)),
      catalog: {
        listActive: vi.fn(async () => Array.from(
          { length: MAX_RECENT_PROJECTS + 2 },
          (_, index) => activeEntry(index + 1, index === 1 ? "Renamed project" : undefined),
        )),
      },
      validateManaged: vi.fn(async (id: string) => {
        const index = Number.parseInt(id.slice(-4), 16);
        return { name: index === 2 ? "Renamed project" : `Project ${index}` };
      }),
      validateLocal: vi.fn(async (_path: string) => ({ name: "Local project" })),
    };
    const store = new RecentProjectsStore(storage, dependencies);

    for (let index = 1; index <= MAX_RECENT_PROJECTS + 2; index += 1) {
      await store.record(managedSession(index));
    }
    await store.record(managedSession(2, "Renamed project"));

    const restarted = new RecentProjectsStore(storage, dependencies);
    const list = await restarted.list();
    expect(list.entries).toHaveLength(MAX_RECENT_PROJECTS);
    expect(list.entries[0]).toMatchObject({ name: "Renamed project", sourceKind: "managed-project" });
    expect(list.entries.filter((entry) => entry.name === "Renamed project")).toHaveLength(1);
    expect(list.entries.some((entry) => entry.name === "Project 1")).toBe(false);
    expect(JSON.stringify(list)).not.toContain("/private/managed");
  });

  it("bootstraps only active managed catalog entries once and filters entries removed by lifecycle", async () => {
    const storage = await config();
    const active = [
      { ...managedSession(1), updatedAt: "2026-07-20T10:00:00.000Z" },
      { ...managedSession(2), updatedAt: "2026-07-20T11:00:00.000Z" },
    ].map(({ projectId: id, descriptor, updatedAt }) => ({
      id,
      directoryName: id,
      name: descriptor.name,
      lifecycle: "active" as const,
      lifecycleRevision: 1,
      createdAt: updatedAt,
      updatedAt,
    }));
    const catalog = { listActive: vi.fn(async () => active) };
    let ordinal = 0;
    const dependencies = {
      createRecentId: () => `recent_${(++ordinal).toString(16).padStart(32, "0")}`,
      catalog,
      validateManaged: vi.fn(async (id: string) => ({ name: active.find((entry) => entry.id === id)!.name })),
      validateLocal: vi.fn(),
    };
    const store = new RecentProjectsStore(storage, dependencies);

    expect((await store.list()).entries.map((entry) => entry.name)).toEqual(["Project 2", "Project 1"]);
    catalog.listActive.mockResolvedValue([active[1]!]);
    expect((await store.list()).entries.map((entry) => entry.name)).toEqual(["Project 2"]);
    expect(catalog.listActive).toHaveBeenCalledTimes(2);
  });

  it("removes history only and permits reopening the same source to add it again", async () => {
    const storage = await config();
    const catalog = { listActive: vi.fn(async () => [activeEntry(1, "Alpha")]) };
    let ordinal = 0;
    const store = new RecentProjectsStore(storage, {
      createRecentId: () => `recent_${(++ordinal).toString(16).padStart(32, "0")}`,
      catalog,
      validateManaged: vi.fn(async () => ({ name: "Alpha" })),
      validateLocal: vi.fn(),
    });
    const project = managedSession(1, "Alpha");
    await store.record(project);
    const recent = (await store.list()).entries[0]!;

    expect(await store.remove(recent.recentId)).toBe(true);
    expect((await store.list()).entries).toEqual([]);
    expect(catalog.listActive).toHaveBeenCalled();

    await store.record(project);
    expect((await store.list()).entries).toHaveLength(1);
  });

  it("keeps unavailable local sources browser-safe and never records or replaces state after failed activation", async () => {
    const storage = await config();
    const localPath = "/Users/alex/Secret Project/app-store-screenshots.json";
    const validateLocal = vi.fn(async () => { throw new Error(`ENOENT ${localPath}`); });
    const store = new RecentProjectsStore(storage, {
      createRecentId: () => "recent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      catalog: { listActive: vi.fn(async () => []) },
      validateManaged: vi.fn(),
      validateLocal,
      inspectLocal: validateLocal,
    });
    await store.record(localSession(1, localPath));
    const before = await readFile(join(storage.root, "recent-projects.json"), "utf8");
    const recent = (await store.list()).entries[0]!;
    const registry = {
      openLocal: vi.fn(async () => { throw new Error("Source is unavailable"); }),
      openManaged: vi.fn(),
    } as unknown as ProjectSessionRegistry;

    expect(recent).toMatchObject({ sourceKind: "local-file", availability: "unavailable" });
    expect(JSON.stringify(recent)).not.toContain("Secret Project");
    await expect(store.activate(recent.recentId, registry)).rejects.toThrow("Source is unavailable");
    expect(await readFile(join(storage.root, "recent-projects.json"), "utf8")).toBe(before);
  });

  it("inspects a recent source without activating it or changing recency", async () => {
    const storage = await config();
    const localPath = "/Users/alex/Preview Project/app-store-screenshots.json";
    const opened = {
      name: "Preview Project",
      projectId: "1".repeat(64),
      projectPath: localPath,
      displayLocation: localPath,
      capabilities: localSession(1, localPath).descriptor.capabilities,
    };
    const validateLocal = vi.fn(async () => opened);
    const store = new RecentProjectsStore(storage, {
      createRecentId: () => "recent_cccccccccccccccccccccccccccccccc",
      catalog: { listActive: vi.fn(async () => []) },
      validateManaged: vi.fn(),
      validateLocal,
      inspectLocal: validateLocal,
    });
    await store.record(localSession(1, localPath));
    const recent = (await store.list()).entries[0]!;
    const before = await readFile(join(storage.root, "recent-projects.json"), "utf8");

    await expect(store.inspect(recent.recentId)).resolves.toEqual(opened);
    expect(validateLocal).toHaveBeenLastCalledWith(localPath);
    expect(await readFile(join(storage.root, "recent-projects.json"), "utf8")).toBe(before);
  });

  it("rebuilds corrupt application history from the active catalog without scanning other directories", async () => {
    const storage = await config();
    await writeFile(join(storage.root, "recent-projects.json"), "{not-json", "utf8");
    const project = managedSession(3, "Recovered");
    const catalog = { listActive: vi.fn(async () => [{
      id: project.projectId,
      directoryName: project.projectId,
      name: project.descriptor.name,
      lifecycle: "active" as const,
      lifecycleRevision: 1,
      createdAt: "2026-07-20T12:00:00.000Z",
      updatedAt: "2026-07-20T12:00:00.000Z",
    }]) };
    const store = new RecentProjectsStore(storage, {
      createRecentId: () => "recent_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      catalog,
      validateManaged: vi.fn(async () => ({ name: "Recovered" })),
      validateLocal: vi.fn(),
    });

    expect((await store.list()).entries).toEqual([expect.objectContaining({ name: "Recovered" })]);
    expect(parseRecentProjectsDocument(JSON.parse(
      await readFile(join(storage.root, "recent-projects.json"), "utf8"),
    ))).toMatchObject({ version: 1, entries: [expect.objectContaining({ name: "Recovered" })] });
  });

  it("retries colliding opaque ids while rebuilding multiple catalog recents", async () => {
    const storage = await config();
    const ids = [
      "recent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "recent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "recent_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ];
    const store = new RecentProjectsStore(storage, {
      createRecentId: () => ids.shift() ?? "recent_cccccccccccccccccccccccccccccccc",
      catalog: { listActive: vi.fn(async () => [activeEntry(1), activeEntry(2)]) },
      validateManaged: vi.fn(async (id: string) => ({ name: id })),
      validateLocal: vi.fn(),
    });

    const document = parseRecentProjectsDocument(JSON.parse(
      await store.list().then(() => readFile(join(storage.root, "recent-projects.json"), "utf8")),
    ));
    expect(new Set(document.entries.map((entry) => entry.recentId)).size).toBe(2);
  });

  it("serializes concurrent records under one bounded application-state lock", async () => {
    const storage = await config();
    let ordinal = 0;
    const store = new RecentProjectsStore(storage, {
      createRecentId: () => `recent_${(++ordinal).toString(16).padStart(32, "0")}`,
      catalog: { listActive: vi.fn(async () => Array.from({ length: 10 }, (_, index) => activeEntry(index + 1))) },
      validateManaged: vi.fn(async (id: string) => ({ name: id })),
      validateLocal: vi.fn(),
    });

    await Promise.all(Array.from({ length: 10 }, (_, index) => store.record(managedSession(index + 1))));
    expect((await store.list()).entries).toHaveLength(10);
  });
});
