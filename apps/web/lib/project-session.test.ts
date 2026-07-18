// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { fetchActiveProject } from "./project-session.js";

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
});
