// SPDX-License-Identifier: Apache-2.0
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ProjectLibraryService } from "@web/lib/project-library.server.js";
import type { ProjectSessionRegistry } from "@web/lib/project-session.server.js";

const projectPath = resolve("fixtures/sample/app-store-screenshots.json");
const managedId = "project_00000000000000000000000000000001";
const localRecentId = "recent_00000000000000000000000000000002";

function activeManaged() {
  return {
    id: managedId,
    directoryName: managedId,
    name: "Managed launch",
    lifecycle: "active" as const,
    lifecycleRevision: 1,
    createdAt: "2026-07-19T10:00:00.000Z",
    updatedAt: "2026-07-20T10:00:00.000Z",
  };
}

describe("ProjectLibraryService", () => {
  it("combines managed catalog entries with local recents without exposing locators", async () => {
    const recent = {
      list: vi.fn(async () => ({ entries: [
        {
          recentId: "recent_00000000000000000000000000000001",
          sourceKind: "managed-project" as const,
          name: "Managed launch",
          lastOpenedAt: "2026-07-20T10:00:00.000Z",
          availability: "available" as const,
        },
        {
          recentId: localRecentId,
          sourceKind: "local-file" as const,
          name: "Local launch",
          lastOpenedAt: "2026-07-20T11:00:00.000Z",
          availability: "available" as const,
        },
      ] })),
      inspect: vi.fn(async () => ({
        name: "Local launch",
        projectId: "2".repeat(64),
        projectPath,
        displayLocation: projectPath,
        capabilities: {
          writeInPlace: true,
          revealLocation: true,
          watchExternalChanges: true,
          nativePicker: false,
          projectLocalResources: true,
          exportProjectArchive: false,
          deleteProjectPermanently: false,
        },
      })),
      activate: vi.fn(),
    };
    const service = new ProjectLibraryService({
      catalog: { listActive: vi.fn(async () => [activeManaged()]) },
      repository: { open: vi.fn(async () => ({ projectPath })) },
      recent,
    });

    const result = await service.list();

    expect(result.entries.map((entry) => [entry.entryId, entry.sourceKind])).toEqual([
      [localRecentId, "local-file"],
      [managedId, "managed-project"],
    ]);
    expect(result.entries[0]).toMatchObject({
      name: "Store Launch Demo",
      availability: "available",
      layoutCount: 1,
    });
    expect(result.entries[0]!.previewScreenIds.length).toBeLessThanOrEqual(3);
    expect(JSON.stringify(result)).not.toContain(projectPath);
    expect(result.entries.some((entry) => entry.entryId.includes("recent_00000000000000000000000000000001"))).toBe(false);
  });

  it("keeps unavailable local recents visible without project preview data", async () => {
    const service = new ProjectLibraryService({
      catalog: { listActive: vi.fn(async () => []) },
      repository: { open: vi.fn() },
      recent: {
        list: vi.fn(async () => ({ entries: [{
          recentId: localRecentId,
          sourceKind: "local-file" as const,
          name: "Missing local",
          lastOpenedAt: "2026-07-20T11:00:00.000Z",
          availability: "unavailable" as const,
        }] })),
        inspect: vi.fn(async () => { throw new Error("missing"); }),
        activate: vi.fn(),
      },
    });

    await expect(service.list()).resolves.toEqual({ entries: [expect.objectContaining({
      entryId: localRecentId,
      availability: "unavailable",
      project: null,
      previewScreenIds: [],
    })] });
  });

  it("activates managed and local entries through their existing session boundaries", async () => {
    const localProjectId = "2".repeat(64);
    const recent = { list: vi.fn(), inspect: vi.fn(), activate: vi.fn(async () => ({
      projectId: localProjectId,
      projectPath,
      descriptor: {
        sessionId: "local-session",
        name: "Local launch",
        sourceKind: "local-file" as const,
        displayLocation: projectPath,
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
    })) };
    const service = new ProjectLibraryService({
      catalog: { listActive: vi.fn(async () => [activeManaged()]) },
      repository: { open: vi.fn() },
      recent,
    });
    const registry = {
      openManaged: vi.fn(async () => ({ projectId: managedId })),
      openLocal: vi.fn(),
    } as unknown as ProjectSessionRegistry;

    await expect(service.activate(managedId, registry)).resolves.toMatchObject({ projectId: managedId });
    await expect(service.activate(localRecentId, registry)).resolves.toMatchObject({ projectId: localProjectId });
    expect(registry.openManaged).toHaveBeenCalledWith(managedId);
    expect(recent.activate).toHaveBeenCalledWith(localRecentId, registry);
  });
});
