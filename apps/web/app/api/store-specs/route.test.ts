// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { handleStoreSpecsGet } from "@web/app/api/store-specs/handler.js";
import { GET } from "@web/app/api/store-specs/route.js";

describe("GET /api/store-specs", () => {
  it("returns parsed store specs including the iphone lead size", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.apple.iphone.some((s: { id: string }) => s.id === "6.9")).toBe(true);
  });

  it("returns a structured 404 when the configured file is missing", async () => {
    const error = Object.assign(new Error("missing specs"), { code: "ENOENT" });
    const response = await handleStoreSpecsGet({
      resolvePath: () => "/missing/store-specs.json",
      readTextFile: vi.fn(async () => { throw error; }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Store specs file was not found" });
  });

  it("returns a structured non-2xx response when the file is unreadable", async () => {
    const error = Object.assign(new Error("permission denied"), { code: "EACCES" });
    const response = await handleStoreSpecsGet({
      resolvePath: () => "/private/store-specs.json",
      readTextFile: vi.fn(async () => { throw error; }),
    });

    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/permission denied/);
  });

  it.each([
    ["malformed JSON", "{"],
    ["schema-invalid JSON", JSON.stringify({
      apple: { iphone: [{ id: "lead", label: "Lead", width: 0, height: 200, orientation: "portrait" }] },
    })],
  ])("returns 422 for %s", async (_label, source) => {
    const response = await handleStoreSpecsGet({
      resolvePath: () => "/project/store-specs.json",
      readTextFile: vi.fn(async () => source),
    });

    expect(response.status).toBe(422);
    expect((await response.json()).error).toEqual(expect.any(String));
  });
});
