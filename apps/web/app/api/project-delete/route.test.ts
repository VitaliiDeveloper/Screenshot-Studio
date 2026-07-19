// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readProjectSnapshot } from "@screenshot-studio/core/storage";
import { resolveManagedProjectStorageConfig } from "@web/lib/managed-project-config.server.js";
import { ManagedProjectLifecycleService } from "@web/lib/managed-project-lifecycle.server.js";
import {
  ManagedProjectNotFoundError,
  ManagedProjectRepository,
} from "@web/lib/managed-project-repository.server.js";
import {
  ManagedProjectSourceAdapter,
  ProjectSessionRegistry,
} from "@web/lib/project-session.server.js";
import {
  handleProjectDeleteOperationPost,
  handleProjectDeletePost,
  type ProjectDeleteRouteDependencies,
} from "./handler.js";

const PROJECT_ID = "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OPERATION_ID = "operation_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const STATUS_SECRET = "3".repeat(64);
const PROJECT_REVISION = "4".repeat(64);
const roots: string[] = [];
const noReadGuard: NonNullable<ProjectDeleteRouteDependencies["managedReadGuard"]> = (
  _session,
  operation,
) => operation();

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function projectJson(): string {
  return JSON.stringify({
    meta: { name: "Delete me", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "primary",
    layouts: [{
      id: "primary",
      name: "Primary",
      mode: "isolated",
      screens: [{
        id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
        artboard: { width: 660, height: 1434 },
        background: { type: "solid", color: "#000000" }, elements: [],
      }],
    }],
  });
}

function registry(sourceKind: "managed-project" | "local-file" = "managed-project") {
  const value = new ProjectSessionRegistry({
    createSessionId: () => "delete-session",
    managedSource: {
      kind: "managed-project",
      open: vi.fn(async () => ({
        name: "Delete me",
        projectId: PROJECT_ID,
        projectPath: "/private/managed/app-store-screenshots.json",
        lifecycleRevision: 7,
        capabilities: {
          writeInPlace: true,
          revealLocation: false,
          watchExternalChanges: false,
          nativePicker: false,
          projectLocalResources: true,
          exportProjectArchive: true,
          deleteProjectPermanently: true,
        },
      })),
    },
  });
  const session = value.openManagedRecord({
    id: PROJECT_ID,
    name: "Delete me",
    projectDirectory: "/private/managed",
    projectPath: "/private/managed/app-store-screenshots.json",
    lifecycleRevision: 7,
  });
  if (sourceKind === "local-file") {
    session.descriptor.sourceKind = "local-file";
    session.descriptor.capabilities.deleteProjectPermanently = false;
  }
  return { registry: value, session };
}

function request(
  sessionId: string,
  body: Record<string, unknown> = {},
  url = "http://localhost/api/project-delete",
) {
  return new Request(url, {
    method: "POST",
    headers: {
      cookie: `screenshot_studio_project_session=${sessionId}`,
      "content-type": "application/json",
      "if-match": `"${PROJECT_REVISION}"`,
      "x-project-id": PROJECT_ID,
    },
    body: JSON.stringify({
      operationId: OPERATION_ID,
      statusSecret: STATUS_SECRET,
      expectedLifecycleRevision: 7,
      confirmation: "Delete me",
      backup: { kind: "none", acknowledged: true },
      ...body,
    }),
  });
}

function completeEvidence() {
  return {
    operationId: OPERATION_ID,
    operation: "delete" as const,
    state: "complete" as const,
    projectId: PROJECT_ID,
    lifecycleRevision: 7,
    statusSecretHash: createHash("sha256").update(STATUS_SECRET).digest("hex"),
    projectRevision: PROJECT_REVISION,
    completedAt: "2026-07-19T00:00:00.000Z",
  };
}

describe("POST /api/project-delete", () => {
  it("permanently deletes the exact managed session and remains queryable only by operation secret", async () => {
    const root = await mkdtemp(join(tmpdir(), "project-delete-route-"));
    roots.push(root);
    const config = resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: root });
    const repository = new ManagedProjectRepository(config);
    const stage = await repository.createStage();
    await writeFile(join(stage.path, "app-store-screenshots.json"), projectJson());
    const project = await repository.publishStage({ token: stage.token });
    const registry = new ProjectSessionRegistry({
      createSessionId: () => "real-delete-session",
      managedSource: new ManagedProjectSourceAdapter(repository),
    });
    const session = await registry.openManaged(project.id);
    const revision = (await readProjectSnapshot(project.projectPath)).revision;
    const lifecycle = new ManagedProjectLifecycleService(config, registry);
    const deleteRequest = new Request("http://localhost/api/project-delete", {
      method: "POST",
      headers: {
        cookie: `screenshot_studio_project_session=${session.descriptor.sessionId}`,
        "content-type": "application/json",
        "if-match": `"${revision}"`,
        "x-project-id": project.id,
      },
      body: JSON.stringify({
        operationId: OPERATION_ID,
        statusSecret: STATUS_SECRET,
        expectedLifecycleRevision: project.lifecycleRevision,
        confirmation: "Delete me",
        backup: { kind: "none", acknowledged: true },
      }),
    });

    const deleted = await handleProjectDeletePost(deleteRequest, {
      registry,
      lifecycle,
      managedStorageConfig: config,
    });

    expect(deleted.status).toBe(200);
    expect(deleted.headers.get("set-cookie")).toContain("screenshot_studio_project_session=");
    expect(deleted.headers.get("set-cookie")).toContain("screenshot_studio_managed_project=");
    expect(deleted.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await deleted.json()).toEqual({ operationId: OPERATION_ID, status: "deleted-complete" });
    expect(registry.peek(session.descriptor.sessionId)).toBeUndefined();
    await expect(repository.open(project.id)).rejects.toBeInstanceOf(ManagedProjectNotFoundError);

    const status = await handleProjectDeleteOperationPost(new Request(
      "http://localhost/api/project-delete/operation",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operationId: OPERATION_ID, statusSecret: STATUS_SECRET }),
      },
    ), { lifecycle, managedStorageConfig: config });
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ operationId: OPERATION_ID, status: "deleted-complete" });
  });

  it("dispatches an exact confirmed managed deletion with a server-side secret hash", async () => {
    const input = registry();
    const lifecycle = {
      permanentlyDelete: vi.fn(async () => completeEvidence()),
      reconcileDeletionOperation: vi.fn(),
    };

    const response = await handleProjectDeletePost(request(input.session.descriptor.sessionId), {
      registry: input.registry,
      lifecycle,
      managedReadGuard: noReadGuard,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ operationId: OPERATION_ID, status: "deleted-complete" });
    expect(lifecycle.permanentlyDelete).toHaveBeenCalledWith(expect.objectContaining({
      id: PROJECT_ID,
      expectedLifecycleRevision: 7,
      expectedProjectRevision: PROJECT_REVISION,
      operationId: OPERATION_ID,
      statusSecretHash: createHash("sha256").update(STATUS_SECRET).digest("hex"),
    }), undefined);
    expect(JSON.stringify(lifecycle.permanentlyDelete.mock.calls)).not.toContain(STATUS_SECRET);
  });

  it("rejects local-file capability, stale lifecycle, confirmation, and archive evidence", async () => {
    const local = registry("local-file");
    const managed = registry();
    const lifecycle = { permanentlyDelete: vi.fn(), reconcileDeletionOperation: vi.fn() };
    const dependencies = {
      lifecycle,
      managedReadGuard: noReadGuard,
    };

    const localResponse = await handleProjectDeletePost(request(local.session.descriptor.sessionId), {
      ...dependencies,
      registry: local.registry,
    });
    const staleLifecycle = await handleProjectDeletePost(request(managed.session.descriptor.sessionId, {
      expectedLifecycleRevision: 8,
    }), { ...dependencies, registry: managed.registry });
    const wrongConfirmation = await handleProjectDeletePost(request(managed.session.descriptor.sessionId, {
      confirmation: "delete",
    }), { ...dependencies, registry: managed.registry });
    const staleArchive = await handleProjectDeletePost(request(managed.session.descriptor.sessionId, {
      backup: { kind: "archive", projectRevision: "5".repeat(64) },
    }), { ...dependencies, registry: managed.registry });

    expect(localResponse.status).toBe(409);
    expect(staleLifecycle.status).toBe(409);
    expect(wrongConfirmation.status).toBe(400);
    expect(staleArchive.status).toBe(412);
    expect(lifecycle.permanentlyDelete).not.toHaveBeenCalled();
  });

  it("rejects malformed or URL-carried credentials before lifecycle lookup", async () => {
    const input = registry();
    const lifecycle = { permanentlyDelete: vi.fn(), reconcileDeletionOperation: vi.fn() };
    const dependencies = {
      registry: input.registry,
      lifecycle,
      managedReadGuard: noReadGuard,
    };
    const invalidBodies = [
      { operationId: "../escape" },
      { statusSecret: "é".repeat(64) },
      { statusSecretHash: "6".repeat(64) },
      { unknown: true },
      { backup: { kind: "none", acknowledged: false } },
    ];
    for (const body of invalidBodies) {
      const response = await handleProjectDeletePost(request(input.session.descriptor.sessionId, body), dependencies);
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    const query = await handleProjectDeletePost(request(
      input.session.descriptor.sessionId,
      {},
      `http://localhost/api/project-delete?statusSecret=${STATUS_SECRET}`,
    ), dependencies);
    expect(query.status).toBe(400);
    const lookalikeContentType = await handleProjectDeletePost(new Request(
      "http://localhost/api/project-delete",
      {
        method: "POST",
        headers: { "content-type": "application/jsonp" },
        body: JSON.stringify({}),
      },
    ), dependencies);
    expect(lookalikeContentType.status).toBe(415);
    expect(lifecycle.permanentlyDelete).not.toHaveBeenCalled();
  });

  it("returns committed cleanup status when the terminal call loses its response", async () => {
    const input = registry();
    const pending = {
      ...completeEvidence(),
      state: "cleanup-pending" as const,
      sourceIdentity: { device: "1", inode: "2" },
    };
    delete (pending as { completedAt?: string }).completedAt;
    const lifecycle = {
      permanentlyDelete: vi.fn(async () => { throw new Error(`/private/${STATUS_SECRET}`); }),
      reconcileDeletionOperation: vi.fn(async () => pending),
    };

    const response = await handleProjectDeletePost(request(input.session.descriptor.sessionId), {
      registry: input.registry,
      lifecycle,
      managedReadGuard: noReadGuard,
    });

    expect(response.status).toBe(202);
    expect(response.headers.get("set-cookie")).toContain("screenshot_studio_project_session=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    const body = await response.json();
    expect(body).toEqual({
      operationId: OPERATION_ID,
      status: "deleted-cleanup-pending",
    });
    expect(JSON.stringify(body)).not.toContain(STATUS_SECRET);
  });

  it("maps a pre-admission Project revision race to a redacted 412", async () => {
    const input = registry();
    const lifecycle = {
      permanentlyDelete: vi.fn(async () => {
        throw new Error(`/private/project: Project revision changed before deletion admission ${STATUS_SECRET}`);
      }),
      reconcileDeletionOperation: vi.fn(async () => undefined),
    };
    const response = await handleProjectDeletePost(request(input.session.descriptor.sessionId), {
      registry: input.registry,
      lifecycle,
      managedReadGuard: noReadGuard,
    });

    expect(response.status).toBe(412);
    const body = await response.json();
    expect(body).toEqual({
      error: "Project changed before permanent deletion; reload and confirm again",
      code: "project-revision-changed",
    });
    expect(JSON.stringify(body)).not.toContain("/private");
    expect(JSON.stringify(body)).not.toContain(STATUS_SECRET);
  });
});

describe("POST /api/project-delete operation status", () => {
  it("reconciles without a project session and never places credentials in the URL", async () => {
    const lifecycle = {
      reconcileDeletionOperation: vi.fn(async () => completeEvidence()),
    };
    const response = await handleProjectDeleteOperationPost(new Request(
      "http://localhost/api/project-delete/operation",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operationId: OPERATION_ID, statusSecret: STATUS_SECRET }),
      },
    ), { lifecycle });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ operationId: OPERATION_ID, status: "deleted-complete" });
    expect(lifecycle.reconcileDeletionOperation).toHaveBeenCalledWith({
      operationId: OPERATION_ID,
      statusSecretHash: createHash("sha256").update(STATUS_SECRET).digest("hex"),
    });
  });

  it("returns one expired-or-unknown result for missing or unauthorized operations", async () => {
    const lifecycle = { reconcileDeletionOperation: vi.fn(async () => undefined) };
    const response = await handleProjectDeleteOperationPost(new Request(
      "http://localhost/api/project-delete/operation",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operationId: OPERATION_ID, statusSecret: STATUS_SECRET }),
      },
    ), { lifecycle });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ status: "expired-or-unknown" });
  });

  it("rejects URL credentials and redacts reconciliation failures", async () => {
    const lifecycle = {
      reconcileDeletionOperation: vi.fn(async () => {
        throw new Error(`/private/tombstone/${STATUS_SECRET}`);
      }),
    };
    const query = await handleProjectDeleteOperationPost(new Request(
      `http://localhost/api/project-delete/operation?statusSecret=${STATUS_SECRET}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operationId: OPERATION_ID, statusSecret: STATUS_SECRET }),
      },
    ), { lifecycle });
    expect(query.status).toBe(400);
    expect(lifecycle.reconcileDeletionOperation).not.toHaveBeenCalled();

    const lookalikeContentType = await handleProjectDeleteOperationPost(new Request(
      "http://localhost/api/project-delete/operation",
      {
        method: "POST",
        headers: { "content-type": "application/json-malformed" },
        body: JSON.stringify({ operationId: OPERATION_ID, statusSecret: STATUS_SECRET }),
      },
    ), { lifecycle });
    expect(lookalikeContentType.status).toBe(415);
    expect(lifecycle.reconcileDeletionOperation).not.toHaveBeenCalled();

    const failed = await handleProjectDeleteOperationPost(new Request(
      "http://localhost/api/project-delete/operation",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operationId: OPERATION_ID, statusSecret: STATUS_SECRET }),
      },
    ), { lifecycle });
    expect(failed.status).toBe(500);
    const body = await failed.json();
    expect(body).toEqual({ error: "Deletion status is temporarily unavailable", code: "internal" });
    expect(JSON.stringify(body)).not.toContain("/private");
    expect(JSON.stringify(body)).not.toContain(STATUS_SECRET);
  });
});
