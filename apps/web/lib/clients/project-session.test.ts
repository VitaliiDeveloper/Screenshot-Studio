// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { closeActiveProject, fetchActiveProject } from "./project-session.js";

describe("project-session client helpers", () => {
  it("returns null for a 204 active-session response", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));

    await expect(fetchActiveProject(fetcher)).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledWith("/api/project-session", { cache: "no-store" });
  });

  it("returns the active project descriptor", async () => {
    const descriptor = {
      sessionId: "session-1",
      name: "Launcher",
      sourceKind: "local-file",
      capabilities: {
        writeInPlace: true,
        revealLocation: true,
        watchExternalChanges: true,
        nativePicker: false,
        projectLocalResources: true,
        exportProjectArchive: false,
        deleteProjectPermanently: false,
      },
    };
    const fetcher = vi.fn(async () => Response.json(descriptor, {
      headers: { "x-project-id": "project-one" },
    }));

    await expect(fetchActiveProject(fetcher)).resolves.toEqual({
      ...descriptor,
      projectId: "project-one",
    });
  });

  it("accepts a server-issued managed lifecycle revision and lifecycle capabilities", async () => {
    const descriptor = {
      sessionId: "managed-session",
      name: "Managed",
      sourceKind: "managed-project",
      lifecycleRevision: 3,
      capabilities: {
        writeInPlace: true,
        revealLocation: false,
        watchExternalChanges: false,
        nativePicker: false,
        projectLocalResources: true,
        exportProjectArchive: true,
        deleteProjectPermanently: true,
      },
    };
    const fetcher = vi.fn(async () => Response.json(descriptor, {
      headers: { "x-project-id": "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    }));

    await expect(fetchActiveProject(fetcher)).resolves.toMatchObject({ lifecycleRevision: 3 });
  });

  it("rejects an active project response without its opaque identity", async () => {
    const fetcher = vi.fn(async () => Response.json({
      sessionId: "session-1",
      name: "Launcher",
      sourceKind: "managed-project",
      capabilities: {},
    }));

    await expect(fetchActiveProject(fetcher)).rejects.toThrow("project identity");
  });

  it("returns the server error when active-session lookup fails", async () => {
    const fetcher = vi.fn(async () => Response.json(
      { error: "Invalid configured project document" },
      { status: 422 },
    ));

    await expect(fetchActiveProject(fetcher))
      .rejects.toThrow("Invalid configured project document");
  });

  it("closes the active project through the opaque project identity", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));

    await expect(closeActiveProject("project-one", fetcher)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith("/api/project-session", {
      method: "DELETE",
      headers: { "x-project-id": "project-one" },
    });
  });

  it("surfaces a rejected close without treating the session as cleared", async () => {
    const fetcher = vi.fn(async () => Response.json(
      { error: "Active project changed; reload it before continuing" },
      { status: 409 },
    ));

    await expect(closeActiveProject("project-one", fetcher)).rejects.toThrow(
      "Active project changed",
    );
  });
});
