// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  fetchProjectLibrary,
  openProjectLibraryEntry,
  projectLibraryEntriesEqual,
  projectLibraryAssetUrl,
} from "./project-library-client.js";

const project = JSON.parse(readFileSync("fixtures/sample/app-store-screenshots.json", "utf8")) as unknown;
const entryId = "project_00000000000000000000000000000001";

function entry(overrides: Record<string, unknown> = {}) {
  return {
    entryId,
    sourceKind: "managed-project",
    name: "Store Launch Demo",
    lastOpenedAt: "2026-07-20T10:00:00.000Z",
    availability: "available",
    platforms: ["apple:iphone"],
    screenCount: 6,
    layoutCount: 1,
    previewLayoutId: "default",
    previewScreenIds: ["hero", "feature-2", "feature-3"],
    previewProject: project,
    ...overrides,
  };
}

describe("project library client", () => {
  it("strictly parses bounded source-safe entries", async () => {
    const transport = vi.fn(async () => Response.json({ entries: [entry()] }));
    await expect(fetchProjectLibrary({ transport })).resolves.toEqual({
      entries: [expect.objectContaining({
        entryId,
        previewProject: expect.objectContaining({ meta: expect.objectContaining({ schemaVersion: 1 }) }),
      })],
    });
    expect(transport).toHaveBeenCalledWith("/api/project-library", { cache: "no-store" });
  });

  it.each([
    { projectPath: "/private/secret" },
    { sourceLocator: "/private/secret" },
    { previewScreenIds: ["1", "2", "3", "4"] },
    { previewProject: { version: 1 } },
  ])("rejects invalid or path-bearing responses %#", async (patch) => {
    const transport = vi.fn(async () => Response.json({ entries: [entry(patch)] }));
    await expect(fetchProjectLibrary({ transport })).rejects.toThrow("Invalid project library response");
  });

  it("opens one opaque entry and validates the activated identity", async () => {
    const transport = vi.fn(async () => Response.json({ projectId: entryId }));
    await expect(openProjectLibraryEntry(entryId, { transport })).resolves.toEqual({ projectId: entryId });
    expect(transport).toHaveBeenCalledWith("/api/project-library", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ entryId }),
    }));
  });

  it("builds an encoded opaque asset URL", () => {
    expect(projectLibraryAssetUrl(entryId, "assets/Hero image.png")).toBe(
      `/api/project-library/asset?entryId=${entryId}&path=assets%2FHero+image.png`,
    );
  });

  it("preserves hydrated entries when the refresh is identical", async () => {
    const first = await fetchProjectLibrary({
      transport: async () => Response.json({ entries: [entry()] }),
    });
    const same = await fetchProjectLibrary({
      transport: async () => Response.json({ entries: [entry()] }),
    });
    const changed = await fetchProjectLibrary({
      transport: async () => Response.json({ entries: [entry({
        lastOpenedAt: "2026-07-21T10:00:00.000Z",
      })] }),
    });

    expect(projectLibraryEntriesEqual(first.entries, same.entries)).toBe(true);
    expect(projectLibraryEntriesEqual(first.entries, changed.entries)).toBe(false);
  });
});
