// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { ProjectRevisionConflictError } from "@screenshot-studio/core/storage";
import { jsonError } from "./api-error-response.server.js";
import { errorResponseByClass } from "./project-request-fence.server.js";

class BaseFailure extends Error {}
class SpecificFailure extends BaseFailure {}

describe("jsonError", () => {
  it("returns an uncached { error } body when no code is given", async () => {
    const response = jsonError(404, "Not here");
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Not here" });
  });

  it("keeps the code and endpoint-specific details", async () => {
    const response = jsonError(422, "Missing files", "missing-resources", { missingResources: ["a.png"] });
    expect(await response.json()).toEqual({
      error: "Missing files",
      code: "missing-resources",
      missingResources: ["a.png"],
    });
  });
});

describe("errorResponseByClass", () => {
  const statuses = [[SpecificFailure, 409], [BaseFailure, 400]] as const;

  it("answers a project revision conflict with the 412 revision contract", async () => {
    const response = errorResponseByClass(new ProjectRevisionConflictError("old", "new"), statuses);
    expect(response.status).toBe(412);
    expect(response.headers.get("etag")).toBe('"new"');
    expect(await response.json()).toMatchObject({ expectedRevision: '"old"', actualRevision: '"new"' });
  });

  it("uses the first matching class in table order", async () => {
    const specific = errorResponseByClass(new SpecificFailure("specific"), statuses);
    expect(specific.status).toBe(409);
    expect(await specific.json()).toEqual({ error: "specific" });
    expect(errorResponseByClass(new BaseFailure("base"), statuses).status).toBe(400);
  });

  it("falls back to an uncached 500 for unknown errors", async () => {
    const response = errorResponseByClass("boom", statuses);
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "boom" });
  });
});
