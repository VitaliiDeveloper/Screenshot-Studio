// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { downloadProjectArchive, requestProjectArchive } from "./project-archive-client.js";

describe("project archive client", () => {
  it("requests the read-only archive ticket without a revision fence", async () => {
    const fetcher = vi.fn(async () => Response.json({
      downloadUrl: `/api/project-archive/artifacts/${"a".repeat(43)}`,
      expiresAt: "2026-07-18T21:00:00.000Z",
      filename: "screenshot-studio-project.zip",
    }, { status: 201 }));

    await expect(requestProjectArchive(fetcher)).resolves.toMatchObject({
      filename: "screenshot-studio-project.zip",
    });
    expect(fetcher).toHaveBeenCalledWith("/api/project-archive", {
      method: "POST",
      cache: "no-store",
    });
  });

  it("uses a native same-origin anchor with the distinct project archive filename", () => {
    const click = vi.fn();
    const remove = vi.fn();
    const anchor = { href: "", download: "", rel: "", click, remove };
    const appendChild = vi.fn();
    const documentLike = {
      createElement: vi.fn(() => anchor),
      body: { appendChild },
    };

    downloadProjectArchive({
      downloadUrl: `/api/project-archive/artifacts/${"a".repeat(43)}`,
      expiresAt: "2026-07-18T21:00:00.000Z",
      filename: "screenshot-studio-project.zip",
    }, documentLike as never);

    expect(anchor.href).toBe(`/api/project-archive/artifacts/${"a".repeat(43)}`);
    expect(anchor.download).toBe("screenshot-studio-project.zip");
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });

  it("surfaces API errors", async () => {
    await expect(requestProjectArchive(vi.fn(async () => Response.json({
      error: "Managed project required",
    }, { status: 409 })))).rejects.toThrow("Managed project required");
  });
});
