// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@screenshot-studio/core/model";

const project = {
  meta: { name: "Saved", schemaVersion: 1 },
  fonts: [],
  preferredExportLayoutId: "primary",
  layouts: [{
    id: "primary",
    name: "Primary",
    mode: "isolated",
    screens: [{
      id: "hero",
      name: "Hero",
      platform: "apple",
      device: "iphone",
      locale: "en",
      direction: "ltr",
      artboard: { width: 660, height: 1434 },
      background: { type: "solid", color: "#000000" },
      elements: [],
    }],
  }],
} satisfies Project;

interface RevisionAwareSaveProjectModule {
  saveProject(project: Project): Promise<void>;
  getProjectRevision(): string | undefined;
  setProjectRevision(revision: string | null): void;
  advanceProjectRevisionFromResponse(response: Pick<Response, "headers">): void;
}

const initialRevision = '"revision-one"';
const savedRevision = '"revision-two"';
let api: RevisionAwareSaveProjectModule;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  api = await import("./save-project.js") as unknown as RevisionAwareSaveProjectModule;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("project revision tracking", () => {
  it("seeds and exposes an opaque quoted ETag", () => {
    expect(api.setProjectRevision).toBeTypeOf("function");
    expect(api.getProjectRevision).toBeTypeOf("function");

    api.setProjectRevision(initialRevision);

    expect(api.getProjectRevision()).toBe(initialRevision);
  });

  it("rejects missing or malformed server ETags without replacing the revision", () => {
    expect(api.setProjectRevision).toBeTypeOf("function");
    expect(api.getProjectRevision).toBeTypeOf("function");
    api.setProjectRevision(initialRevision);

    expect(() => api.setProjectRevision(null)).toThrow(/ETag/i);
    expect(() => api.setProjectRevision("unquoted")).toThrow(/ETag/i);
    expect(() => api.setProjectRevision('W/"weak"')).toThrow(/ETag/i);
    expect(api.getProjectRevision()).toBe(initialRevision);
  });

  it("advances a resource mutation revision from its response ETag", () => {
    api.setProjectRevision(initialRevision);
    api.advanceProjectRevisionFromResponse(new Response(null, {
      headers: { etag: savedRevision },
    }));
    expect(api.getProjectRevision()).toBe(savedRevision);
  });
});

describe("saveProject", () => {
  it("sends If-Match and advances the revision only after a successful save", async () => {
    expect(api.setProjectRevision).toBeTypeOf("function");
    expect(api.getProjectRevision).toBeTypeOf("function");
    api.setProjectRevision(initialRevision);
    fetchMock.mockResolvedValue(Response.json(project, {
      headers: { etag: savedRevision },
    }));

    await api.saveProject(project);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("if-match")).toBe(initialRevision);
    expect(api.getProjectRevision()).toBe(savedRevision);
  });

  it("surfaces a conflict without retrying or replacing the revision", async () => {
    expect(api.setProjectRevision).toBeTypeOf("function");
    expect(api.getProjectRevision).toBeTypeOf("function");
    api.setProjectRevision(initialRevision);
    fetchMock.mockResolvedValue(Response.json({
      error: "Project changed on disk",
      expectedRevision: initialRevision,
      actualRevision: savedRevision,
    }, { status: 412 }));

    await expect(api.saveProject(project)).rejects.toThrow("Project changed on disk");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(api.getProjectRevision()).toBe(initialRevision);
  });

  it("fails before writing when no project revision was seeded", async () => {
    expect(api.getProjectRevision).toBeTypeOf("function");
    expect(api.getProjectRevision()).toBeUndefined();

    await expect(api.saveProject(project)).rejects.toThrow(/revision/i);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retains the previous revision when a successful response has no valid ETag", async () => {
    expect(api.setProjectRevision).toBeTypeOf("function");
    expect(api.getProjectRevision).toBeTypeOf("function");
    api.setProjectRevision(initialRevision);
    fetchMock.mockResolvedValue(Response.json(project));

    await expect(api.saveProject(project)).rejects.toThrow(/ETag/i);

    expect(api.getProjectRevision()).toBe(initialRevision);
  });
});
