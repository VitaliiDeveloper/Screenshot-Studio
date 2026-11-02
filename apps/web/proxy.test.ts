// SPDX-License-Identifier: Apache-2.0
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import { config } from "./proxy.js";

describe("proxy matcher", () => {
  it.each([
    "/api/project-library",
    "/api/project-library/asset?entryId=project_1&path=assets/a.png",
    "/api/capture-import/preview",
    "/api/export/artifacts/token",
    "/api/instance/open",
  ])("guards %s", (path) => {
    expect(unstable_doesMiddlewareMatch({ config, url: `http://127.0.0.1:3000${path}` })).toBe(true);
  });

  it.each(["/editor/project_1", "/render", "/_next/static/chunk.js"])("leaves %s to its own guards", (path) => {
    expect(unstable_doesMiddlewareMatch({ config, url: `http://127.0.0.1:3000${path}` })).toBe(false);
  });
});
