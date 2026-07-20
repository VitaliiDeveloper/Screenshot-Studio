// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { handleProjectLibraryAssetGet } from "./handler.js";

const entryId = "project_00000000000000000000000000000001";

describe("project library asset handler", () => {
  it("resolves an opaque entry server-side and serves only the requested relative asset", async () => {
    const resolveProjectPath = vi.fn(async () => "/private/managed/project/app-store-screenshots.json");
    const serveAsset = vi.fn(async () => new Response("png", {
      headers: { "content-type": "image/png" },
    }));
    const response = await handleProjectLibraryAssetGet(new Request(
      `http://localhost/api/project-library/asset?entryId=${entryId}&path=assets%2Fhero.png`,
    ), { resolveProjectPath } as never, serveAsset);

    expect(response.status).toBe(200);
    expect(resolveProjectPath).toHaveBeenCalledWith(entryId);
    expect(serveAsset).toHaveBeenCalledWith(
      "/private/managed/project/app-store-screenshots.json",
      "assets/hero.png",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
  });

  it("rejects missing, malformed, and unavailable entries without exposing paths", async () => {
    const service = { resolveProjectPath: vi.fn(async () => { throw new Error("/private/secret"); }) };
    const missing = await handleProjectLibraryAssetGet(new Request(
      "http://localhost/api/project-library/asset?path=assets%2Fhero.png",
    ), service as never, vi.fn());
    expect(missing.status).toBe(400);

    const unavailable = await handleProjectLibraryAssetGet(new Request(
      `http://localhost/api/project-library/asset?entryId=${entryId}&path=assets%2Fhero.png`,
    ), service as never, vi.fn());
    expect(unavailable.status).toBe(404);
    expect(await unavailable.text()).not.toContain("/private/secret");
  });
});
