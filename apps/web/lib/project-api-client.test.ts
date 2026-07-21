// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearProjectPersistenceIdentity,
  getProjectRevision,
  setProjectPersistenceIdentity,
} from "@web/lib/save-project.js";
import { projectJsonRequest } from "@web/lib/project-api-client.js";

afterEach(() => clearProjectPersistenceIdentity());

describe("project API client", () => {
  it("fences mutations and advances the shared revision", async () => {
    setProjectPersistenceIdentity("project-a", '"revision-a"');
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("x-project-id")).toBe("project-a");
      expect(headers.get("if-match")).toBe('"revision-a"');
      return Response.json({ value: 42 }, { headers: { etag: '"revision-b"' } });
    });

    const result = await projectJsonRequest<{ value: number }>("/api/example", {
      method: "POST",
      conditional: true,
      advanceRevision: true,
      errorFallback: "Operation failed",
      fetcher: fetcher as typeof fetch,
    });

    expect(result.body.value).toBe(42);
    expect(getProjectRevision()).toBe('"revision-b"');
  });

  it("uses the server message and does not advance revision after failure", async () => {
    setProjectPersistenceIdentity("project-a", '"revision-a"');

    await expect(projectJsonRequest("/api/example", {
      errorFallback: "Operation failed",
      advanceRevision: true,
      fetcher: vi.fn(async () => Response.json(
        { error: "Rejected by server" },
        { status: 409, headers: { etag: '"revision-b"' } },
      )) as typeof fetch,
    })).rejects.toThrow("Rejected by server");
    expect(getProjectRevision()).toBe('"revision-a"');
  });
});
