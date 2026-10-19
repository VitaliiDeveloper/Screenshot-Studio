// SPDX-License-Identifier: Apache-2.0
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STORE_SPECS } from "@screenshot-studio/core/export";
import { type Project } from "@screenshot-studio/core/model";
import { projectRevision, serializeProject } from "@screenshot-studio/core/storage";
import {
  applyCaptureImportToProject,
  SafeFileConflictError,
} from "@screenshot-studio/cli/capture-import-transaction";
import { resolveManagedProjectStorageConfig } from "@web/lib/managed-projects/managed-project-config.server.js";
import { ManagedProjectCatalogStore } from "@web/lib/managed-projects/managed-project-catalog.server.js";
import { ManagedProjectCreationService } from "@web/lib/managed-projects/managed-project-creation.server.js";
import { ManagedProjectRepository } from "@web/lib/managed-projects/managed-project-repository.server.js";
import { ManagedProjectSourceAdapter, ProjectSessionRegistry } from "@web/lib/session/project-session.server.js";
import {
  handleCaptureImportApplyPost,
  handleCaptureImportPreviewPost,
} from "@web/app/api/capture-import/handler.js";
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
const specs = DEFAULT_STORE_SPECS;

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

function request(input: {
  destinationKind: "current-project" | "new-project";
  confirmationFingerprint?: string;
  revision?: string;
  signal?: AbortSignal;
}): Request {
  const form = new FormData();
  form.set("destinationKind", input.destinationKind);
  if (input.destinationKind === "current-project") form.set("layoutId", "default");
  else {
    form.set("name", "Imported capture project");
    form.set("platform", "apple");
    form.set("device", "iphone");
    form.set("layoutMode", "connected");
    form.set("templateId", "");
  }
  form.append("paths", "screenshots/apple/iphone/en/01.png");
  form.append("files", new Blob([png]), "01.png");
  if (input.confirmationFingerprint) {
    form.set("confirmationFingerprint", input.confirmationFingerprint);
  }
  return new Request("http://localhost/api/capture-import/apply", {
    method: "POST",
    headers: input.destinationKind === "current-project" ? {
      cookie: `screenshot_studio_project_session=${sessionId}`,
      "x-project-id": projectId,
      "if-match": `"${input.revision ?? revision}"`,
    } : undefined,
    body: form,
    signal: input.signal,
  });
}

async function preview(kind: "current-project" | "new-project") {
  const response = await handleCaptureImportPreviewPost(request({ destinationKind: kind }), {
    repository, creationService, registry,
  });
  expect(response.status).toBe(200);
  return (await response.json() as { preview: { confirmationFingerprint: string } }).preview;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "capture-apply-route-"));
  const config = resolveManagedProjectStorageConfig({
    SCREENSHOT_STUDIO_DATA_ROOT: join(root, "managed"),
    SCREENSHOT_STUDIO_MAX_PROJECT_FILES: "20",
    SCREENSHOT_STUDIO_MAX_PROJECT_BYTES: "10000000",
    SCREENSHOT_STUDIO_MAX_IMPORT_UPLOAD_BYTES: "10000000",
  });
  repository = new ManagedProjectRepository(config);
  await repository.initialize();
  const projectDirectory = join(config.projectsRoot, projectId);
  await mkdir(projectDirectory);
  projectPath = join(projectDirectory, "app-store-screenshots.json");
  const bytes = serializeProject(currentProject());
  await writeFile(projectPath, bytes);
  revision = projectRevision(bytes);
  const timestamp = "2026-07-19T00:00:00.000Z";
  await new ManagedProjectCatalogStore(config).insert({
    id: projectId,
    directoryName: projectId,
    name: "Current receiver",
    lifecycle: "active",
    lifecycleRevision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  creationService = new ManagedProjectCreationService(repository, { storeSpecs: specs });
  let index = 0;
  registry = new ProjectSessionRegistry({
    createSessionId: () => `capture-session-${index++}`,
    managedSource: new ManagedProjectSourceAdapter(repository),
  });
  sessionId = registry.openManagedRecord({
    id: projectId,
    name: "Current receiver",
    projectDirectory,
    projectPath,
    lifecycleRevision: 1,
  }).descriptor.sessionId;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("POST /api/capture-import/apply", () => {
  it("applies the confirmed current-project plan under identity and revision fences", async () => {
    const plan = await preview("current-project");
    const response = await handleCaptureImportApplyPost(request({
      destinationKind: "current-project",
      confirmationFingerprint: plan.confirmationFingerprint,
    }), { repository, creationService, registry });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).not.toBe(`"${revision}"`);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(body).toMatchObject({
      project: { sessionId, name: "Current receiver" },
      imported: 1,
      receiving: { kind: "current-project", layoutId: "default" },
    });
    const persisted = JSON.parse(await readFile(projectPath, "utf8")) as Project;
    expect(persisted.layouts[0]!.screens.map(({ id }) => id)).toEqual([
      "hero", "apple-iphone-en-01",
    ]);
  });

  it("publishes and activates only the confirmed new managed destination", async () => {
    const recordRecent = vi.fn(async () => undefined);
    const previous = registry.get(sessionId);
    const plan = await preview("new-project");
    const response = await handleCaptureImportApplyPost(request({
      destinationKind: "new-project",
      confirmationFingerprint: plan.confirmationFingerprint,
    }), { repository, creationService, registry, recentProjects: { record: recordRecent } });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toContain("screenshot_studio_project_session=capture-session-1");
    expect(response.headers.get("x-project-id")).toMatch(/^project_[0-9a-f]{32}$/u);
    expect(body).toMatchObject({
      project: {
        sessionId: "capture-session-1",
        name: "Imported capture project",
        sourceKind: "managed-project",
      },
      imported: 1,
    });
    expect(registry.get(sessionId)).toBe(previous);
    await expect(repository.list()).resolves.toHaveLength(2);
    expect(recordRecent).toHaveBeenCalledOnce();
    expect(recordRecent).toHaveBeenCalledWith(expect.objectContaining({
      descriptor: expect.objectContaining({ name: "Imported capture project" }),
    }));
  });

  it("rejects missing or changed confirmation with no project, catalog, session, or resource writes", async () => {
    const before = await readFile(projectPath);
    const missing = await handleCaptureImportApplyPost(request({
      destinationKind: "current-project",
    }), { repository, creationService, registry });
    const currentChanged = await handleCaptureImportApplyPost(request({
      destinationKind: "current-project", confirmationFingerprint: "0".repeat(64),
    }), { repository, creationService, registry });
    const newChanged = await handleCaptureImportApplyPost(request({
      destinationKind: "new-project", confirmationFingerprint: "0".repeat(64),
    }), { repository, creationService, registry });

    expect(missing.status).toBe(400);
    expect(currentChanged.status).toBe(409);
    expect(newChanged.status).toBe(409);
    expect(currentChanged.headers.get("set-cookie")).toBeNull();
    expect(newChanged.headers.get("set-cookie")).toBeNull();
    expect(await readFile(projectPath)).toEqual(before);
    await expect(readdir(join(projectPath, "..", "assets"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(repository.list()).resolves.toHaveLength(1);
    expect(registry.get("capture-session-1")).toBeUndefined();
  });

  it("rejects a stale current revision and cancellation without one-shot artifacts", async () => {
    const plan = await preview("current-project");
    const stale = await handleCaptureImportApplyPost(request({
      destinationKind: "current-project",
      confirmationFingerprint: plan.confirmationFingerprint,
      revision: "0".repeat(64),
    }), { repository, creationService, registry });
    const controller = new AbortController();
    controller.abort();
    const cancelled = await handleCaptureImportApplyPost(request({
      destinationKind: "new-project",
      confirmationFingerprint: "0".repeat(64),
      signal: controller.signal,
    }), { repository, creationService, registry });

    expect(stale.status).toBe(412);
    expect(cancelled.status).toBe(499);
    await expect(repository.list()).resolves.toHaveLength(1);
  });

  it("maps cancellation during confirmed scaffold planning and current transaction work to 499", async () => {
    const newPlan = await preview("new-project");
    const newController = new AbortController();
    const abortingCreationService = new ManagedProjectCreationService(repository, {
      loadStoreSpecs: async () => {
        newController.abort();
        return specs;
      },
    });
    const cancelledNew = await handleCaptureImportApplyPost(request({
      destinationKind: "new-project",
      confirmationFingerprint: newPlan.confirmationFingerprint,
      signal: newController.signal,
    }), { repository, creationService: abortingCreationService, registry });

    const currentPlan = await preview("current-project");
    const currentController = new AbortController();
    const cancelledCurrent = await handleCaptureImportApplyPost(request({
      destinationKind: "current-project",
      confirmationFingerprint: currentPlan.confirmationFingerprint,
      signal: currentController.signal,
    }), {
      repository,
      creationService,
      registry,
      applyCurrent: async (input) => {
        currentController.abort();
        return applyCaptureImportToProject(input);
      },
    });

    expect(cancelledNew.status).toBe(499);
    expect(cancelledCurrent.status).toBe(499);
    expect(cancelledNew.headers.get("set-cookie")).toBeNull();
    expect(cancelledCurrent.headers.get("set-cookie")).toBeNull();
    await expect(repository.list()).resolves.toHaveLength(1);
    await expect(readdir(join(projectPath, "..", "assets"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not disclose server paths from apply failures and wires the dedicated route", async () => {
    const plan = await preview("new-project");
    const privatePath = join(root, "private-stage");
    const failingService = new ManagedProjectCreationService(repository, {
      loadStoreSpecs: async () => { throw new Error(`cannot read ${privatePath}`); },
    });
    const response = await handleCaptureImportApplyPost(request({
      destinationKind: "new-project",
      confirmationFingerprint: plan.confirmationFingerprint,
    }), { repository, creationService: failingService, registry });
    const body = await response.text();

    expect(response.status).toBe(422);
    expect(body).not.toContain(root);
    expect(body).not.toContain("private-stage");
    expect(POST).toBeTypeOf("function");
  });

  it("classifies a final publication collision as a changed preview", async () => {
    const plan = await preview("current-project");
    const response = await handleCaptureImportApplyPost(request({
      destinationKind: "current-project",
      confirmationFingerprint: plan.confirmationFingerprint,
    }), {
      repository,
      creationService,
      registry,
      applyCurrent: async () => {
        throw new SafeFileConflictError(join(projectPath, "..", "assets", "occupied.png"));
      },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Capture import preview changed; preview again before applying",
      code: "preview-changed",
    });
  });
});
