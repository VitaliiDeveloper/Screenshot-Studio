// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import {
  fetchActiveProject,
  openLocalProject,
} from "./project-session.js";

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
    const fetcher = vi.fn(async () => Response.json(descriptor));

    await expect(fetchActiveProject(fetcher)).resolves.toEqual(descriptor);
  });

  it("returns the server error when opening fails", async () => {
    const fetcher = vi.fn(async () => Response.json(
      { error: "Invalid project document" },
      { status: 422 },
    ));

    await expect(openLocalProject("/broken/project.json", fetcher))
      .rejects.toThrow("Invalid project document");
  });
});
