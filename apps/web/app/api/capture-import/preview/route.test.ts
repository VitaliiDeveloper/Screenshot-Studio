// SPDX-License-Identifier: Apache-2.0
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseStoreSpecs } from "@screenshot-studio/core/export";
import { type Project } from "@screenshot-studio/core/model";
import { projectRevision, serializeProject } from "@screenshot-studio/core/storage";
import { resolveManagedProjectStorageConfig } from "@web/lib/managed-project-config.server.js";
import { ManagedProjectCreationService } from "@web/lib/managed-project-creation.server.js";
import { ManagedProjectRepository } from "@web/lib/managed-project-repository.server.js";
import { ProjectSessionRegistry } from "@web/lib/project-session.server.js";
import { handleCaptureImportPreviewPost } from "../handler.js";
import { POST } from "./route.js";

let root: string;
let projectPath: string;
let revision: string;
let repository: ManagedProjectRepository;
let creationService: ManagedProjectCreationService;
let registry: ProjectSessionRegistry;
let sessionId: string;
const projectId = "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const png = new Uint8Array(await readFile(new URL(
  "../../../../../../fixtures/regressions/screenshot-parity/assets/shot.png",
  import.meta.url,
)));
const specs = parseStoreSpecs({
  apple: { iphone: [{ id: "lead", label: "Apple lead", width: 1320, height: 2868, orientation: "portrait" }] },
  android: { phone: [{ id: "lead", label: "Android lead", width: 1080, height: 1920, orientation: "portrait" }] },
  windows: { desktop: [{ id: "lead", label: "Windows lead", width: 1920, height: 1080, orientation: "landscape" }] },
});

function currentProject(): Project {
  return {
    meta: { name: "Current receiver", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [{
      id: "default", name: "Primary", mode: "isolated", screens: [{
        id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
        direction: "ltr", artboard: { width: 1320, height: 2868 },
        background: { type: "solid", color: "#101827" }, elements: [],
      }],
    }],
  };
}

function captureRequest(input: {
  destinationKind: "current-project" | "new-project";
  revision?: string;
  projectId?: string;
  extra?: [string, string];
  assetBytes?: string;
}): Request {
  const form = new FormData();
  form.set("destinationKind", input.destinationKind);
  if (input.destinationKind === "current-project") form.set("layoutId", "default");
  else {
    form.set("name", "New receiver");
    form.set("platform", "apple");
    form.set("layoutMode", "isolated");
    form.set("templateId", "");
  }
  form.append("paths", "Selected/screenshots/apple/iphone/en/01.png");
  form.append("files", new Blob([png]), "01.png");
  if (input.assetBytes) {
    form.append("paths", "Selected/assets/icons/product.png");
    form.append("files", new Blob([input.assetBytes]), "product.png");
  }
  if (input.extra) form.set(...input.extra);
  return new Request("http://localhost/api/capture-import/preview", {
    method: "POST",
    headers: input.destinationKind === "current-project" ? {
      cookie: `screenshot_studio_project_session=${sessionId}`,
      "x-project-id": input.projectId ?? projectId,
      "if-match": `"${input.revision ?? revision}"`,
    } : undefined,
    body: form,
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "capture-preview-route-"));
  projectPath = join(root, "current", "app-store-screenshots.json");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(join(root, "current"), { recursive: true }));
  const bytes = serializeProject(currentProject());
  await writeFile(projectPath, bytes);
  revision = projectRevision(bytes);
  repository = new ManagedProjectRepository(resolveManagedProjectStorageConfig({
    SCREENSHOT_STUDIO_DATA_ROOT: join(root, "managed"),
    SCREENSHOT_STUDIO_MAX_PROJECT_FILES: "20",
    SCREENSHOT_STUDIO_MAX_PROJECT_BYTES: "10000000",
    SCREENSHOT_STUDIO_MAX_IMPORT_UPLOAD_BYTES: "10000000",
  }));
  creationService = new ManagedProjectCreationService(repository, { storeSpecs: specs });
  registry = new ProjectSessionRegistry({ createSessionId: () => "current-session" });
  sessionId = registry.openManagedRecord({
    id: projectId,
    name: "Current receiver",
    projectDirectory: join(root, "current"),
    projectPath,
    lifecycleRevision: 1,
  }).descriptor.sessionId;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe("POST /api/capture-import/preview", () => {
  it("returns a public repeatable current-project plan while performing zero writes", async () => {
    const before = await readFile(projectPath);
    const first = await handleCaptureImportPreviewPost(captureRequest({
      destinationKind: "current-project",
    }), { repository, creationService, registry });
    const second = await handleCaptureImportPreviewPost(captureRequest({
      destinationKind: "current-project",
    }), { repository, creationService, registry });
    const firstBody = await first.json();
    const secondBody = await second.json();

    expect(first.status).toBe(200);
    expect(first.headers.get("etag")).toBe(`"${revision}"`);
    expect(firstBody).toEqual(secondBody);
    expect(firstBody).toMatchObject({
      preview: {
        receiving: { kind: "current-project", projectName: "Current receiver", layoutId: "default" },
        summary: { screenCount: 1, platforms: [{ id: "apple", count: 1 }] },
        canApply: true,
      },
    });
    expect(firstBody.preview.screens[0]).toMatchObject({
      screenId: "apple-iphone-en-01", sourcePath: "screenshots/apple/iphone/en/01.png",
    });
    expect(firstBody.preview.resources[0]).not.toHaveProperty("bytes");
    expect(firstBody.preview).not.toHaveProperty("project");
    expect(firstBody.preview).not.toHaveProperty("sourceFingerprint");
    expect(firstBody.preview).not.toHaveProperty("targetRevision");
    expect(first.headers.get("set-cookie")).toBeNull();
    expect(await readFile(projectPath)).toEqual(before);
    await expect(repository.list()).resolves.toEqual([]);
  });

  it("shows an existing receiver-resource mismatch as invalid before confirmation", async () => {
    const assetPath = join(root, "current", "assets", "icons", "product.png");
    await mkdir(join(root, "current", "assets", "icons"), { recursive: true });
    await writeFile(assetPath, "receiver bytes");
    const beforeProject = await readFile(projectPath);

    const response = await handleCaptureImportPreviewPost(captureRequest({
      destinationKind: "current-project",
      assetBytes: "different source bytes",
    }), { repository, creationService, registry });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.preview).toMatchObject({
      canApply: false,
      invalidEntries: [{
        code: "destination-conflict",
        path: "assets/icons/product.png",
        message: expect.stringMatching(/already exists.*different bytes/i),
      }],
    });
    expect(await readFile(projectPath)).toEqual(beforeProject);
    await expect(readFile(assetPath, "utf8")).resolves.toBe("receiver bytes");
  });

  it("previews a new managed destination without staging, catalog, or session activation", async () => {
    const createStage = vi.spyOn(repository, "createStage");
    const response = await handleCaptureImportPreviewPost(captureRequest({
      destinationKind: "new-project",
    }), { repository, creationService, registry });

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toMatchObject({
      preview: { receiving: { kind: "new-project", projectName: "New receiver", layoutId: "default" } },
    });
    expect(createStage).not.toHaveBeenCalled();
    await expect(access(repository.config.root)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(repository.list()).resolves.toEqual([]);
  });

  it("rejects missing, stale, or cross-project current target fences before reading a plan", async () => {
    const missingRevision = captureRequest({ destinationKind: "current-project" });
    missingRevision.headers.delete("if-match");
    const missing = await handleCaptureImportPreviewPost(missingRevision, { repository, registry });
    const stale = await handleCaptureImportPreviewPost(captureRequest({
      destinationKind: "current-project", revision: "0".repeat(64),
    }), { repository, registry });
    const crossed = await handleCaptureImportPreviewPost(captureRequest({
      destinationKind: "current-project", projectId: "project_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    }), { repository, registry });

    expect(missing.status).toBe(428);
    expect(stale.status).toBe(412);
    expect(crossed.status).toBe(409);
  });

  it("does not touch active-session LRU order while previewing", async () => {
    let lruIndex = 0;
    const lruRegistry = new ProjectSessionRegistry({
      createSessionId: () => `lru-session-${lruIndex++}`,
    });
    const lruSessionId = lruRegistry.openManagedRecord({
      id: projectId,
      name: "Current receiver",
      projectDirectory: join(root, "current"),
      projectPath,
      lifecycleRevision: 1,
    }).descriptor.sessionId;
    for (let index = 1; index < 30; index += 1) {
      lruRegistry.openManagedRecord({
        id: `project_${index.toString(16).padStart(32, "0")}`,
        name: `Other ${index}`,
        projectDirectory: join(root, `other-${index}`),
        projectPath,
        lifecycleRevision: 1,
      });
    }

    const request = captureRequest({ destinationKind: "current-project" });
    request.headers.set("cookie", `screenshot_studio_project_session=${lruSessionId}`);
    const response = await handleCaptureImportPreviewPost(request, {
      repository, creationService, registry: lruRegistry,
    });
    expect(response.status).toBe(200);

    lruRegistry.openManagedRecord({
      id: `project_${"f".repeat(32)}`,
      name: "Overflow",
      projectDirectory: join(root, "overflow"),
      projectPath,
      lifecycleRevision: 1,
    });
    expect(lruRegistry.get(lruSessionId)).toBeUndefined();
  });

  it("does not rehydrate a missing session from a managed recovery cookie", async () => {
    const openManaged = vi.fn(async () => ({
      name: "Recovered",
      projectId,
      projectPath,
      lifecycleRevision: 1,
      capabilities: {
        writeInPlace: true,
        revealLocation: false,
        watchExternalChanges: false,
        nativePicker: false,
        projectLocalResources: true,
        exportProjectArchive: true,
        trashProject: true,
        restoreProject: false,
        purgeProject: false,
      },
    }));
    const readOnlyRegistry = new ProjectSessionRegistry({
      createSessionId: () => "should-not-register",
      managedSource: { kind: "managed-project", open: openManaged },
    });
    const request = captureRequest({ destinationKind: "current-project" });
    request.headers.set("cookie", `screenshot_studio_managed_project=${projectId}`);

    const response = await handleCaptureImportPreviewPost(request, {
      repository, creationService, registry: readOnlyRegistry,
    });

    expect(response.status).toBe(409);
    expect(openManaged).not.toHaveBeenCalled();
    expect(readOnlyRegistry.get("should-not-register")).toBeUndefined();
  });

  it("keeps invalid entries and warnings understandable instead of mutating", async () => {
    const form = new FormData();
    form.set("destinationKind", "current-project");
    form.set("layoutId", "default");
    form.append("paths", "../escape.png");
    form.append("files", new Blob([png]), "escape.png");
    form.append("paths", "notes.txt");
    form.append("files", new Blob(["note"]), "notes.txt");
    const request = new Request("http://localhost/api/capture-import/preview", {
      method: "POST",
      headers: {
        cookie: `screenshot_studio_project_session=${sessionId}`,
        "x-project-id": projectId,
        "if-match": `"${revision}"`,
      },
      body: form,
    });

    const response = await handleCaptureImportPreviewPost(request, { repository, registry });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.preview.canApply).toBe(false);
    expect(body.preview.invalidEntries).toMatchObject([{ code: "unsafe-path", path: "../escape.png" }]);
    expect(body.preview.warnings).toMatchObject([{ code: "unsupported-input", path: "notes.txt" }]);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects whole-project terminology fields, malformed alignment, media, and upload limits", async () => {
    const unexpected = await handleCaptureImportPreviewPost(captureRequest({
      destinationKind: "new-project", extra: ["kind", "folder"],
    }), { repository, creationService, registry });
    const wrongMedia = await handleCaptureImportPreviewPost(new Request(
      "http://localhost/api/capture-import/preview",
      { method: "POST", body: "plain" },
    ), { repository, creationService, registry });
    const malformedMultipart = await handleCaptureImportPreviewPost(new Request(
      "http://localhost/api/capture-import/preview",
      {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=missing" },
        body: "not-a-multipart-body",
      },
    ), { repository, creationService, registry });
    const misalignedForm = new FormData();
    misalignedForm.set("destinationKind", "new-project");
    misalignedForm.set("name", "Broken");
    misalignedForm.set("platform", "apple");
    misalignedForm.set("layoutMode", "isolated");
    misalignedForm.set("templateId", "");
    misalignedForm.set("paths", "apple/iphone/en/01.png");
    const misaligned = await handleCaptureImportPreviewPost(new Request(
      "http://localhost/api/capture-import/preview", { method: "POST", body: misalignedForm },
    ), { repository, creationService, registry });
    const missingTemplateForm = new FormData();
    missingTemplateForm.set("destinationKind", "new-project");
    missingTemplateForm.set("name", "Missing explicit template choice");
    missingTemplateForm.set("platform", "apple");
    missingTemplateForm.set("layoutMode", "isolated");
    missingTemplateForm.set("paths", "apple/iphone/en/01.png");
    missingTemplateForm.set("files", new Blob([png]), "01.png");
    const missingTemplate = await handleCaptureImportPreviewPost(new Request(
      "http://localhost/api/capture-import/preview",
      { method: "POST", body: missingTemplateForm },
    ), { repository, creationService, registry });
    const limited = new Request("http://localhost/api/capture-import/preview", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=unused",
        "content-length": "10000001",
      },
      body: new ReadableStream<Uint8Array>(),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const overLimit = await handleCaptureImportPreviewPost(limited, {
      repository, creationService, registry,
    });

    expect(unexpected.status).toBe(400);
    expect(wrongMedia.status).toBe(415);
    expect(malformedMultipart.status).toBe(400);
    expect(misaligned.status).toBe(400);
    expect(missingTemplate.status).toBe(400);
    expect(overLimit.status).toBe(413);
    await expect(repository.list()).resolves.toEqual([]);
  });

  it("wires the dedicated preview route", () => {
    expect(POST).toBeTypeOf("function");
  });
});
