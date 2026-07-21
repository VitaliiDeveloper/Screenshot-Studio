// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import {
  fetchRecentProjects,
  openRecentProject,
  removeRecentProject,
  type RecentProjectsTransport,
} from "@web/lib/recent-projects-client.js";

const recentId = "recent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("recent projects client", () => {
  it("loads strict browser-safe descriptors without accepting source locators", async () => {
    const transport = vi.fn<RecentProjectsTransport>(async () => Response.json({ entries: [{
      recentId,
      sourceKind: "managed-project",
      name: "Launch",
      lastOpenedAt: "2026-07-20T12:00:00.000Z",
      availability: "available",
    }] }));

    await expect(fetchRecentProjects({ transport })).resolves.toEqual({ entries: [{
      recentId,
      sourceKind: "managed-project",
      name: "Launch",
      lastOpenedAt: "2026-07-20T12:00:00.000Z",
      availability: "available",
    }] });
    await expect(fetchRecentProjects({
      transport: async () => Response.json({ entries: [{
        recentId,
        sourceKind: "local-file",
        sourceLocator: "/Users/alex/private",
        name: "Unsafe",
        lastOpenedAt: "2026-07-20T12:00:00.000Z",
        availability: "available",
      }] }),
    })).rejects.toThrow(/invalid recent projects response/i);
  });

  it("opens and removes one opaque recent through exact mutation requests", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const transport: RecentProjectsTransport = async (url, init) => {
      requests.push({ url, init });
      return init?.method === "DELETE"
        ? new Response(null, { status: 204 })
        : Response.json({ projectId: "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    };

    await expect(openRecentProject(recentId, { transport })).resolves.toEqual({
      projectId: "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    await expect(removeRecentProject(recentId, { transport })).resolves.toBeUndefined();
    expect(requests).toEqual([
      expect.objectContaining({
        url: "/api/recent-projects/open",
        init: expect.objectContaining({ method: "POST", body: JSON.stringify({ recentId }) }),
      }),
      expect.objectContaining({
        url: "/api/recent-projects",
        init: expect.objectContaining({ method: "DELETE", body: JSON.stringify({ recentId }) }),
      }),
    ]);
  });

  it("accepts the opaque hashed identity returned when a local-file recent opens", async () => {
    const projectId = "a".repeat(64);

    await expect(openRecentProject(recentId, {
      transport: async () => Response.json({ projectId }),
    })).resolves.toEqual({ projectId });
  });

  it("preserves actionable API errors and rejects malformed success", async () => {
    await expect(openRecentProject(recentId, {
      transport: async () => Response.json({ error: "Source unavailable" }, { status: 409 }),
    })).rejects.toThrow("Source unavailable");
    await expect(openRecentProject(recentId, {
      transport: async () => Response.json({ projectId: "../../private" }),
    })).rejects.toThrow(/invalid recent project response/i);
  });
});
