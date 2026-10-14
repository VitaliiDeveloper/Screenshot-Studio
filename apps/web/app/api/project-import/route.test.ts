// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveManagedProjectStorageConfig } from "@web/lib/managed-project-config.server.js";
import { ManagedProjectRepository } from "@web/lib/managed-project-repository.server.js";
import { ProjectSessionRegistry } from "@web/lib/project-session.server.js";
import { handleProjectImportPost } from "./handler.js";
import { POST } from "./route.js";

let root: string;
let repository: ManagedProjectRepository;
let registry: ProjectSessionRegistry;

function projectJson(name = "Imported"): string {
  return JSON.stringify({
    meta: { name, schemaVersion: 1 },
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
        artboard: { width: 660, height: 1434 },
        background: { type: "solid", color: "#000000" },
        elements: [],
      }],
    }],
  });
}

function projectJsonWithAsset(path: string): string {
  const project = JSON.parse(projectJson("With asset")) as {
    layouts: Array<{ screens: Array<{ elements: unknown[] }> }>;
  };
  project.layouts[0]!.screens[0]!.elements = [{
    id: "shot",
    type: "screenshot",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    assetUrl: path,
    fit: "cover",
    cornerRadius: 0,
  }];
  return JSON.stringify(project);
}

function uploadRequest(kind: "folder" | "archive" | "json", files: Array<[string, Blob, string]>): Request {
  const form = new FormData();
  form.set("kind", kind);
  for (const [path, blob, filename] of files) {
    form.append("paths", path);
    form.append("files", blob, filename);
  }
  return new Request("http://localhost/api/project-import", { method: "POST", body: form });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "project-import-route-"));
  repository = new ManagedProjectRepository(resolveManagedProjectStorageConfig({
    SCREENSHOT_STUDIO_DATA_ROOT: root,
    SCREENSHOT_STUDIO_MAX_PROJECT_FILES: "20",
    SCREENSHOT_STUDIO_MAX_PROJECT_BYTES: "100000",
    SCREENSHOT_STUDIO_MAX_IMPORT_UPLOAD_BYTES: "100000",
  }));
  registry = new ProjectSessionRegistry({ createSessionId: () => "imported-session" });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("POST /api/project-import", () => {
  it("imports standalone JSON into a managed copy and activates its opaque session", async () => {
    const recordRecent = vi.fn(async () => undefined);
    const response = await handleProjectImportPost(uploadRequest("json", [
      ["chosen.json", new Blob([projectJson("JSON project")], { type: "application/json" }), "chosen.json"],
    ]), { repository, registry, recentProjects: { record: recordRecent } });

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain(
      "screenshot_studio_project_session=imported-session",
    );
    expect(response.headers.get("set-cookie")).toContain(
      "screenshot_studio_managed_project=project_",
    );
    expect(response.headers.get("x-project-id")).toMatch(/^project_[0-9a-f]{32}$/);
    expect(await response.json()).toMatchObject({
      project: {
        sessionId: "imported-session",
        name: "JSON project",
        sourceKind: "managed-project",
        capabilities: { revealLocation: false },
      },
    });
    await expect(repository.list()).resolves.toHaveLength(1);
    expect(recordRecent).toHaveBeenCalledOnce();
    expect(recordRecent).toHaveBeenCalledWith(expect.objectContaining({
      descriptor: expect.objectContaining({ name: "JSON project" }),
    }));
  });

  it("imports a bounded ZIP through the same managed-copy pipeline", async () => {
    const zip = new JSZip();
    zip.file("app-store-screenshots.json", projectJson("Archive project"));
    zip.file("AGENTS.md", "# Guidance\n");
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });

    const response = await handleProjectImportPost(uploadRequest("archive", [
      ["project.zip", new Blob([new Uint8Array(bytes)], { type: "application/zip" }), "project.zip"],
    ]), { repository, registry });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ project: { name: "Archive project" } });
    await expect(repository.list()).resolves.toHaveLength(1);
  });

  it("preserves aligned browser folder paths and strips one selected root", async () => {
    const response = await handleProjectImportPost(uploadRequest("folder", [
      ["Selected/app-store-screenshots.json", new Blob([projectJsonWithAsset("screenshots/hero.png")]), "app-store-screenshots.json"],
      ["Selected/screenshots/hero.png", new Blob([new Uint8Array([1, 2, 3])]), "hero.png"],
    ]), { repository, registry });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ project: { name: "With asset" } });
  });

  it("returns missing resources without publishing or changing the cookie", async () => {
    const response = await handleProjectImportPost(uploadRequest("json", [
      ["chosen.json", new Blob([projectJsonWithAsset("screenshots/missing.png")]), "chosen.json"],
    ]), { repository, registry });

    expect(response.status).toBe(422);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toMatchObject({
      code: "missing-resources",
      missingResources: ["screenshots/missing.png"],
    });
    await expect(repository.list()).resolves.toEqual([]);
  });

  it("maps browser cancellation without parsing, publication, or cookie mutation", async () => {
    const controller = new AbortController();
    controller.abort();
    const form = new FormData();
    form.set("kind", "json");
    form.set("paths", "chosen.json");
    form.set("files", new Blob([projectJson()]), "chosen.json");
    const request = new Request("http://localhost/api/project-import", {
      method: "POST",
      body: form,
      signal: controller.signal,
    });

    const response = await handleProjectImportPost(request, { repository, registry });

    expect(response.status).toBe(499);
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(repository.list()).resolves.toEqual([]);
  });

  it("preserves the prior session and catalog on validation failure", async () => {
    const previous = registry.openManagedRecord({
      id: "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      name: "Previous",
      projectDirectory: "/private/previous",
      projectPath: "/private/previous/app-store-screenshots.json",
      lifecycleRevision: 1,
    });
    const invalid = JSON.stringify({ unknown: true });
    const request = uploadRequest("json", [
      ["bad.json", new Blob([invalid], { type: "application/json" }), "bad.json"],
    ]);
    request.headers.set("cookie", `screenshot_studio_project_session=${previous.descriptor.sessionId}`);

    const response = await handleProjectImportPost(request, { repository, registry });

    expect(response.status).toBe(422);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(registry.get(previous.descriptor.sessionId)).toBe(previous);
    await expect(repository.list()).resolves.toEqual([]);
  });

  it("rejects malformed requests and upload limits without activation", async () => {
    const wrongMedia = await handleProjectImportPost(new Request(
      "http://localhost/api/project-import",
      { method: "POST", body: "json" },
    ), { repository, registry });
    expect(wrongMedia.status).toBe(415);

    const oversized = uploadRequest("json", [
      ["project.json", new Blob([projectJson()]), "project.json"],
    ]);
    oversized.headers.set("content-length", "100001");
    const limited = await handleProjectImportPost(oversized, { repository, registry });
    expect(limited.status).toBe(413);
    expect(limited.headers.get("set-cookie")).toBeNull();

    const streamLimitedRepository = new ManagedProjectRepository(resolveManagedProjectStorageConfig({
      SCREENSHOT_STUDIO_DATA_ROOT: join(root, "stream-limited"),
      SCREENSHOT_STUDIO_MAX_PROJECT_FILES: "20",
      SCREENSHOT_STUDIO_MAX_PROJECT_BYTES: "100000",
      SCREENSHOT_STUDIO_MAX_IMPORT_UPLOAD_BYTES: "100",
    }));
    const unknownLength = uploadRequest("json", [
      ["project.json", new Blob([projectJson()]), "project.json"],
    ]);
    expect(unknownLength.headers.get("content-length")).toBeNull();
    const streamedLimit = await handleProjectImportPost(unknownLength, {
      repository: streamLimitedRepository,
      registry,
    });
    expect(streamedLimit.status).toBe(413);
  });

  it("wires the Next route without exposing any path activation endpoint", () => {
    expect(POST).toBeTypeOf("function");
  });
});
