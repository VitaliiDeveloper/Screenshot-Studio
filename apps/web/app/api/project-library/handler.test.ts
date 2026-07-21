// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import {
  handleProjectLibraryGet,
  handleProjectLibraryOpen,
} from "./handler.js";
import type { ProjectSessionRegistry } from "@web/lib/project-session.server.js";

const managedId = "project_00000000000000000000000000000001";

describe("project library handler", () => {
  it("returns the source-safe library with no-store policy", async () => {
    const list = vi.fn(async () => ({ entries: [{ entryId: managedId }] }));
    const response = await handleProjectLibraryGet({ list } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ entries: [{ entryId: managedId }] });
  });

  it("accepts exactly one opaque entry id and activates it", async () => {
    const activate = vi.fn(async () => ({
      projectId: managedId,
      projectPath: "/private/not-returned/app-store-screenshots.json",
      descriptor: { sessionId: "session-1" },
    }));
    const request = new Request("http://localhost/api/project-library", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entryId: managedId }),
    });
    const registry = {} as ProjectSessionRegistry;

    const response = await handleProjectLibraryOpen(request, { activate } as never, registry);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(body)).toEqual({ projectId: managedId });
    expect(activate).toHaveBeenCalledWith(managedId, registry);
    expect(body).not.toContain("not-returned");
  });

  it("rejects unknown fields and unavailable entries", async () => {
    const activate = vi.fn(async () => { throw new Error("missing"); });
    const invalid = await handleProjectLibraryOpen(new Request("http://localhost/api/project-library", {
      method: "POST",
      body: JSON.stringify({ entryId: managedId, projectPath: "/private/leak" }),
    }), { activate } as never, {} as ProjectSessionRegistry);
    expect(invalid.status).toBe(400);

    const unavailable = await handleProjectLibraryOpen(new Request("http://localhost/api/project-library", {
      method: "POST",
      body: JSON.stringify({ entryId: managedId }),
    }), { activate } as never, {} as ProjectSessionRegistry);
    expect(unavailable.status).toBe(409);
    await expect(unavailable.json()).resolves.toEqual({
      error: "This project is unavailable. Reopen or import its source to continue.",
    });
  });
});
