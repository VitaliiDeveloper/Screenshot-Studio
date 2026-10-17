// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readProjectSnapshot } from "@screenshot-studio/core/storage";
import { ManagedProjectCatalogStore } from "@web/lib/managed-projects/managed-project-catalog.server.js";
import { ManagedProjectNotFoundError } from "@web/lib/managed-projects/managed-project-repository.server.js";
import {
  ManagedProjectSourceAdapter,
  NoActiveProjectError,
  ProjectSessionRegistry,
  resolveActiveProjectSession,
  type LocalFileProjectSourceAdapter,
} from "./project-session.server.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createProject(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "project-session-"));
  temporaryRoots.push(root);
  const path = join(root, "app-store-screenshots.json");
  await writeFile(path, JSON.stringify({
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
  }));
  return path;
}

function createStubLocalSource() {
  return {
    kind: "local-file",
    open: vi.fn(async (requestedPath: string) => ({
      name: requestedPath,
      projectId: `project:${requestedPath}`,
      projectPath: `/canonical/${requestedPath}.json`,
      displayLocation: `/canonical/${requestedPath}.json`,
      capabilities: {
        writeInPlace: true,
        revealLocation: true,
        watchExternalChanges: true,
        nativePicker: false,
        projectLocalResources: true,
        exportProjectArchive: false,
        deleteProjectPermanently: false,
      },
    })),
  } satisfies Pick<LocalFileProjectSourceAdapter, "kind" | "open">;
}

function createStubManagedSource() {
  return {
    kind: "managed-project",
    open: vi.fn(async (projectId: string) => {
      if (projectId === "missing"
        || projectId === "project_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb") {
        throw new ManagedProjectNotFoundError();
      }
      return {
        name: "Managed",
        projectId,
        projectPath: `/managed/${projectId}/app-store-screenshots.json`,
        lifecycleRevision: 3,
        capabilities: {
          writeInPlace: true,
          revealLocation: false,
          watchExternalChanges: false,
          nativePicker: false,
          projectLocalResources: true,
          exportProjectArchive: true,
          deleteProjectPermanently: true,
        },
      };
    }),
  } satisfies { kind: string; open(projectId: string): Promise<unknown> };
}

describe("ProjectSessionRegistry", () => {
  it("invalidates a cached managed session after permanent deletion is reserved", async () => {
    const root = await mkdtemp(join(tmpdir(), "project-session-delete-"));
    temporaryRoots.push(root);
    const { resolveManagedProjectStorageConfig } = await import("@web/lib/managed-projects/managed-project-config.server.js");
    const { ManagedProjectRepository } = await import("@web/lib/managed-projects/managed-project-repository.server.js");
    const repository = new ManagedProjectRepository(resolveManagedProjectStorageConfig({
      SCREENSHOT_STUDIO_DATA_ROOT: root,
    }));
    const stage = await repository.createStage();
    await writeFile(join(stage.path, "app-store-screenshots.json"), JSON.stringify({
      meta: { name: "Managed", schemaVersion: 1 }, fonts: [], preferredExportLayoutId: "primary",
      layouts: [{ id: "primary", name: "Primary", mode: "isolated", screens: [{
        id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
        artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#000000" }, elements: [],
      }] }],
    }));
    const project = await repository.publishStage({ token: stage.token });
    const registry = new ProjectSessionRegistry({
      createSessionId: () => "managed-session",
      managedSource: new ManagedProjectSourceAdapter(repository),
    });
    const session = await registry.openManaged(project.id);
    const catalog = new ManagedProjectCatalogStore(repository.config);
    const priorEntry = (await catalog.read()).entries[0]!;
    const identity = await stat(project.projectDirectory, { bigint: true });
    await catalog.reserveDeletion({
      operationId: "operation_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      operation: "delete",
      state: "reserved",
      projectId: project.id,
      lifecycleRevision: 1,
      statusSecretHash: "2".repeat(64),
      projectRevision: (await readProjectSnapshot(project.projectPath)).revision,
      priorEntry,
      sourceIdentity: { device: identity.dev.toString(), inode: identity.ino.toString() },
    });

    await expect(resolveActiveProjectSession(new Request("http://localhost", {
      headers: { cookie: `screenshot_studio_project_session=${session.descriptor.sessionId}` },
    }), { registry, configuredPath: () => null })).rejects.toBeInstanceOf(NoActiveProjectError);
    expect(registry.peek(session.descriptor.sessionId)).toBeUndefined();
  });

  it("invalidates only managed sessions for a deleted opaque project id", async () => {
    let nextSession = 0;
    const registry = new ProjectSessionRegistry({
      createSessionId: () => `session-${++nextSession}`,
      localSource: createStubLocalSource(),
      managedSource: createStubManagedSource(),
    });
    const managed = await registry.openManaged("project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const local = await registry.openLocal("local-project");

    expect(registry.invalidateManagedProject(managed.projectId)).toBe(1);
    expect(registry.peek(managed.descriptor.sessionId)).toBeUndefined();
    expect(registry.peek(local.descriptor.sessionId)).toBe(local);
    expect(registry.invalidateManagedProject(managed.projectId)).toBe(0);
  });

  it("rehydrates a managed session from its recovery hint after registry loss", async () => {
    const projectId = "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const managedSource = createStubManagedSource();
    const restartedRegistry = new ProjectSessionRegistry({
      createSessionId: () => "recovered-session",
      managedSource,
    });

    const recovered = await resolveActiveProjectSession(new Request(
      "http://localhost/api/project-session",
      { headers: { cookie: `screenshot_studio_managed_project=${projectId}` } },
    ), { registry: restartedRegistry, configuredPath: () => null });

    expect(managedSource.open).toHaveBeenCalledWith(projectId);
    expect(recovered).toMatchObject({
      projectId,
      descriptor: {
        sessionId: "recovered-session",
        sourceKind: "managed-project",
      },
    });
  });

  it("treats a stale managed recovery hint as no active project", async () => {
    const restartedRegistry = new ProjectSessionRegistry({
      createSessionId: () => "unused-session",
      managedSource: createStubManagedSource(),
    });

    await expect(resolveActiveProjectSession(new Request(
      "http://localhost/api/project-session",
      {
        headers: {
          cookie: "screenshot_studio_managed_project=project_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      },
    ), { registry: restartedRegistry, configuredPath: () => null }))
      .rejects.toBeInstanceOf(NoActiveProjectError);
  });

  it("recognizes a stale managed recovery hint across development module reloads", async () => {
    const reloadedNotFound = new Error("Managed project does not exist");
    reloadedNotFound.name = "ManagedProjectNotFoundError";
    const restartedRegistry = new ProjectSessionRegistry({
      createSessionId: () => "unused-session",
      managedSource: {
        kind: "managed-project",
        open: vi.fn(async () => { throw reloadedNotFound; }),
      },
    });

    await expect(resolveActiveProjectSession(new Request(
      "http://localhost/api/project-session",
      {
        headers: {
          cookie: "screenshot_studio_managed_project=project_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      },
    ), { registry: restartedRegistry, configuredPath: () => null }))
      .rejects.toBeInstanceOf(NoActiveProjectError);
  });

  it("does not replace a managed project with a configured local project after a recovery failure", async () => {
    const localSource = createStubLocalSource();
    const restartedRegistry = new ProjectSessionRegistry({
      createSessionId: () => "unused-session",
      localSource,
      managedSource: {
        kind: "managed-project",
        open: vi.fn(async () => { throw new Error("Managed catalog is unreadable"); }),
      },
    });

    await expect(resolveActiveProjectSession(new Request(
      "http://localhost/api/project-session",
      {
        headers: {
          cookie: "screenshot_studio_managed_project=project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      },
    ), { registry: restartedRegistry, configuredPath: () => "configured-project" }))
      .rejects.toThrow("Unable to reopen the managed project");
    expect(localSource.open).not.toHaveBeenCalled();
  });

  it("ignores malformed managed recovery hints", async () => {
    const managedSource = createStubManagedSource();
    const restartedRegistry = new ProjectSessionRegistry({
      createSessionId: () => "unused-session",
      managedSource,
    });

    await expect(resolveActiveProjectSession(new Request(
      "http://localhost/api/project-session",
      { headers: { cookie: "screenshot_studio_managed_project=../../private" } },
    ), { registry: restartedRegistry, configuredPath: () => null }))
      .rejects.toBeInstanceOf(NoActiveProjectError);
    expect(managedSource.open).not.toHaveBeenCalled();
  });

  it("keeps a live local session ahead of any stale managed recovery hint", async () => {
    const managedSource = createStubManagedSource();
    const registry = new ProjectSessionRegistry({
      createSessionId: () => "local-session",
      localSource: createStubLocalSource(),
      managedSource,
    });
    const local = await registry.openLocal("local-project");

    const resolved = await resolveActiveProjectSession(new Request(
      "http://localhost/api/project-session",
      {
        headers: {
          cookie: [
            "screenshot_studio_project_session=local-session",
            "screenshot_studio_managed_project=project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          ].join("; "),
        },
      },
    ), { registry, configuredPath: () => null });

    expect(resolved).toBe(local);
    expect(managedSource.open).not.toHaveBeenCalled();
  });

  it("activates an imported managed record without reopening it or exposing its server path", async () => {
    const managedSource = createStubManagedSource();
    const registry = new ProjectSessionRegistry({
      createSessionId: () => "imported-session",
      managedSource,
    });

    const session = registry.openManagedRecord({
      id: "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      name: "Imported",
      projectDirectory: "/private/managed/project",
      projectPath: "/private/managed/project/app-store-screenshots.json",
      lifecycleRevision: 1,
    });

    expect(managedSource.open).not.toHaveBeenCalled();
    expect(session).toMatchObject({
      projectId: "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      projectPath: "/private/managed/project/app-store-screenshots.json",
      descriptor: {
        sessionId: "imported-session",
        name: "Imported",
        sourceKind: "managed-project",
        lifecycleRevision: 1,
      },
    });
    expect(session.descriptor).not.toHaveProperty("displayLocation");
  });

  it("opens managed projects without exposing their server location", async () => {
    const registry = new ProjectSessionRegistry({
      createSessionId: () => "managed-session",
      managedSource: createStubManagedSource(),
    });
    const projectId = "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    const session = await registry.openManaged(projectId);

    expect(session).toMatchObject({
      projectId,
      descriptor: {
        sessionId: "managed-session",
        name: "Managed",
        sourceKind: "managed-project",
        lifecycleRevision: 3,
        capabilities: {
          writeInPlace: true,
          revealLocation: false,
          watchExternalChanges: false,
          nativePicker: false,
          projectLocalResources: true,
          exportProjectArchive: true,
          deleteProjectPermanently: true,
        },
      },
    });
    expect(session.descriptor).not.toHaveProperty("displayLocation");
    await expect(registry.openManaged("missing")).rejects.toThrow("Managed project does not exist");
    expect(registry.get("managed-session")).toBe(session);
  });

  it("evicts the least-recently-used session from both indexes after 30 projects", async () => {
    let nextSessionId = 0;
    const registry = new ProjectSessionRegistry({
      createSessionId: () => `session-${++nextSessionId}`,
      localSource: createStubLocalSource(),
    });
    const opened = [];

    for (let index = 0; index < 31; index += 1) {
      opened.push(await registry.openLocal(`project-${index}`));
    }
    const oldest = opened[0]!;
    const nextOldest = opened[1]!;

    expect(registry.get(oldest.descriptor.sessionId)).toBeUndefined();
    expect(registry.get(nextOldest.descriptor.sessionId)).toBe(nextOldest);

    const reopened = await registry.openLocal("project-0");
    expect(reopened.descriptor.sessionId).not.toBe(oldest.descriptor.sessionId);
  });

  it("refreshes recency when a session is resolved by id", async () => {
    let nextSessionId = 0;
    const registry = new ProjectSessionRegistry({
      createSessionId: () => `session-${++nextSessionId}`,
      localSource: createStubLocalSource(),
    });
    const opened = [];

    for (let index = 0; index < 30; index += 1) {
      opened.push(await registry.openLocal(`project-${index}`));
    }
    const oldest = opened[0]!;
    const nextOldest = opened[1]!;
    expect(registry.get(oldest.descriptor.sessionId)).toBe(oldest);

    await registry.openLocal("project-30");

    expect(registry.get(oldest.descriptor.sessionId)).toBe(oldest);
    expect(registry.get(nextOldest.descriptor.sessionId)).toBeUndefined();
  });

  it("refreshes recency when the same canonical path is opened again", async () => {
    let nextSessionId = 0;
    const registry = new ProjectSessionRegistry({
      createSessionId: () => `session-${++nextSessionId}`,
      localSource: createStubLocalSource(),
    });
    const opened = [];

    for (let index = 0; index < 30; index += 1) {
      opened.push(await registry.openLocal(`project-${index}`));
    }
    const oldest = opened[0]!;
    const nextOldest = opened[1]!;
    await expect(registry.openLocal("project-0")).resolves.toBe(oldest);

    await registry.openLocal("project-30");

    expect(registry.get(oldest.descriptor.sessionId)).toBe(oldest);
    expect(registry.get(nextOldest.descriptor.sessionId)).toBeUndefined();
  });

  it("closes only the identity-fenced session and removes its source lookup", async () => {
    let nextSessionId = 0;
    const registry = new ProjectSessionRegistry({
      createSessionId: () => `session-${++nextSessionId}`,
      localSource: createStubLocalSource(),
    });
    const first = await registry.openLocal("first");
    const second = await registry.openLocal("second");

    expect(registry.close(first.descriptor.sessionId, "wrong-project")).toBe(false);
    expect(registry.get(first.descriptor.sessionId)).toBe(first);
    expect(registry.close(first.descriptor.sessionId, first.projectId)).toBe(true);
    expect(registry.get(first.descriptor.sessionId)).toBeUndefined();
    expect(registry.get(second.descriptor.sessionId)).toBe(second);

    const reopened = await registry.openLocal("first");
    expect(reopened.descriptor.sessionId).not.toBe(first.descriptor.sessionId);
  });

  it("keeps opaque sessions when the server module is re-evaluated", async () => {
    const projectPath = await createProject("Reloaded module");
    vi.resetModules();
    const firstModule = await import("./project-session.server.js");
    const opened = await firstModule.projectSessionRegistry.openLocal(projectPath);

    vi.resetModules();
    const reloadedModule = await import("./project-session.server.js");

    expect(reloadedModule.projectSessionRegistry).toBe(firstModule.projectSessionRegistry);
    expect(reloadedModule.projectSessionRegistry.get(opened.descriptor.sessionId)?.projectPath)
      .toBe(await realpath(projectPath));
  });

  it("registers validated local projects with deterministic active-session descriptors", async () => {
    const firstPath = await createProject("First");
    const secondPath = await createProject("Second");
    const invalidRoot = await mkdtemp(join(tmpdir(), "project-session-invalid-"));
    temporaryRoots.push(invalidRoot);
    const invalidJsonPath = join(invalidRoot, "app-store-screenshots.json");
    await writeFile(invalidJsonPath, "not JSON");
    const registry = new ProjectSessionRegistry({
      createSessionId: vi.fn()
        .mockReturnValueOnce("session-a")
        .mockReturnValueOnce("session-b"),
    });

    const first = await registry.openLocal(firstPath);
    const second = await registry.openLocal(secondPath);

    expect(first).toMatchObject({
      descriptor: {
        sessionId: "session-a",
        sourceKind: "local-file",
        name: "First",
        displayLocation: await realpath(firstPath),
        capabilities: {
          writeInPlace: true,
          revealLocation: true,
          watchExternalChanges: true,
          nativePicker: false,
          projectLocalResources: true,
          exportProjectArchive: false,
        },
      },
    });
    expect(second.descriptor.sessionId).toBe("session-b");
    expect(registry.get("session-a")?.projectPath).toBe(await realpath(firstPath));
    expect(registry.get("missing")).toBeUndefined();

    await expect(registry.openLocal(invalidJsonPath)).rejects.toThrow();
    expect(registry.get("session-b")?.projectPath).toBe(await realpath(secondPath));

    const cookieRequest = new Request("http://localhost/api/project", {
      headers: { cookie: "screenshot_studio_project_session=session-a" },
    });
    await expect(resolveActiveProjectSession(cookieRequest, {
      registry,
      configuredPath: () => null,
    })).resolves.toBe(first);

    await expect(resolveActiveProjectSession(new Request("http://localhost/api/project", {
      headers: { cookie: "screenshot_studio_project_session=%E0%A4%A" },
    }), {
      registry,
      configuredPath: () => null,
    })).rejects.toThrow("No active project is selected");
  });

  it("turns an opened local source into a session without reaching into core storage", async () => {
    const opened = {
      name: "Chosen",
      projectId: "project-id",
      projectPath: "/canonical/chosen.json",
      displayLocation: "/canonical/chosen.json",
      capabilities: {
        writeInPlace: true,
        revealLocation: true,
        watchExternalChanges: true,
        nativePicker: false,
        projectLocalResources: true,
        exportProjectArchive: false,
      },
    };
    const localSource = {
      kind: "local-file",
      open: vi.fn().mockResolvedValue(opened),
    } satisfies Pick<LocalFileProjectSourceAdapter, "kind" | "open">;
    const registry = new ProjectSessionRegistry({
      createSessionId: () => "session-chosen",
      localSource,
    });

    await expect(registry.openLocal("chosen.json")).resolves.toMatchObject({
      descriptor: { sessionId: "session-chosen", name: "Chosen" },
      projectId: "project-id",
      projectPath: "/canonical/chosen.json",
    });
    expect(localSource.open).toHaveBeenCalledOnce();
    expect(localSource.open).toHaveBeenCalledWith("chosen.json");
  });
});
