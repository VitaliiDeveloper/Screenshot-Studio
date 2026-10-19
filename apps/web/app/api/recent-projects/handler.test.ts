// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import type { RecentProjectsStore } from "@web/lib/session/recent-projects.server.js";
import type { ProjectSession } from "@web/lib/session/project-session.server.js";
import {
  handleRecentProjectOpen,
  handleRecentProjectsDelete,
  handleRecentProjectsGet,
} from "./handler.js";

const managedSession: ProjectSession = {
  projectId: "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  projectPath: "/private/managed/project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/app-store-screenshots.json",
  descriptor: {
    sessionId: "recent-session",
    name: "Launch",
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

function service(overrides: Partial<RecentProjectsStore> = {}): RecentProjectsStore {
  return {
    list: vi.fn(async () => ({ entries: [] })),
    remove: vi.fn(async () => false),
    activate: vi.fn(async () => managedSession),
    ...overrides,
  } as unknown as RecentProjectsStore;
}

describe("recent projects route handlers", () => {
  it("returns only browser-safe recent descriptors with no cacheable source locator", async () => {
    const recents = service({
      list: vi.fn(async () => ({ entries: [{
        recentId: "recent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sourceKind: "local-file" as const,
        name: "Private launch",
        lastOpenedAt: "2026-07-20T12:00:00.000Z",
        availability: "unavailable" as const,
      }] })),
    });
    const response = await handleRecentProjectsGet(recents);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(await response.json())).not.toContain("/Users/");
  });

  it("removes only the exact opaque history entry", async () => {
    const remove = vi.fn(async () => true);
    const recents = service({ remove });
    const response = await handleRecentProjectsDelete(new Request(
      "http://localhost/api/recent-projects",
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recentId: "recent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
      },
    ), recents);

    expect(response.status).toBe(204);
    expect(remove).toHaveBeenCalledWith("recent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("rejects malformed removal without invoking history mutation", async () => {
    const remove = vi.fn();
    const response = await handleRecentProjectsDelete(new Request(
      "http://localhost/api/recent-projects",
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recentId: "../../private", extra: true }),
      },
    ), service({ remove }));

    expect(response.status).toBe(400);
    expect(remove).not.toHaveBeenCalled();
  });

  it("activates a validated recent and issues the normal source-neutral session cookies", async () => {
    const activate = vi.fn(async () => managedSession);
    const response = await handleRecentProjectOpen(new Request(
      "https://localhost/api/recent-projects/open",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recentId: "recent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
      },
    ), service({ activate }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ projectId: managedSession.projectId });
    expect(response.headers.get("set-cookie")).toContain("screenshot_studio_project_session=recent-session");
    expect(response.headers.get("set-cookie")).toContain(
      `screenshot_studio_managed_project=${managedSession.projectId}`,
    );
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it("leaves activation cookies unchanged and redacts source errors when recovery fails", async () => {
    const activate = vi.fn(async () => {
      throw new Error("ENOENT: /Users/alex/Secret/app-store-screenshots.json");
    });
    const response = await handleRecentProjectOpen(new Request(
      "http://localhost/api/recent-projects/open",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recentId: "recent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
      },
    ), service({ activate }));

    expect(response.status).toBe(409);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({
      error: "This recent project is unavailable. Reopen or import the source to add it again.",
    });
  });
});
