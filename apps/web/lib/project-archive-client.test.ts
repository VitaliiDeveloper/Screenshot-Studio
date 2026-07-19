// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { downloadProjectArchive, requestProjectArchive } from "./project-archive-client.js";

describe("project archive client", () => {
  it("requests a revision-fenced archive ticket and validates its immutable Project revision", async () => {
    const fetcher = vi.fn(async () => Response.json({
      downloadUrl: `/api/project-archive/artifacts/${"a".repeat(43)}`,
      expiresAt: "2026-07-18T21:00:00.000Z",
      filename: "screenshot-studio-project.zip",
      projectRevision: "1".repeat(64),
    }, { status: 201 }));

    await expect(requestProjectArchive("project-one", "1".repeat(64), fetcher)).resolves.toMatchObject({
      filename: "screenshot-studio-project.zip",
      projectRevision: "1".repeat(64),
    });
    expect(fetcher).toHaveBeenCalledWith("/api/project-archive", {
      method: "POST",
      cache: "no-store",
      headers: { "if-match": `"${"1".repeat(64)}"`, "x-project-id": "project-one" },
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
      projectRevision: "1".repeat(64),
    }, documentLike as never);

    expect(anchor.href).toBe(`/api/project-archive/artifacts/${"a".repeat(43)}`);
    expect(anchor.download).toBe("screenshot-studio-project.zip");
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });

  it("surfaces API errors", async () => {
    await expect(requestProjectArchive("project-one", "1".repeat(64), vi.fn(async () => Response.json({
      error: "Managed project required",
    }, { status: 409 })))).rejects.toThrow("Managed project required");
  });
});
