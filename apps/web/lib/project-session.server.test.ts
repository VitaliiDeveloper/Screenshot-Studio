// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
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
      },
    })),
  } satisfies Pick<LocalFileProjectSourceAdapter, "kind" | "open">;
}

function createStubManagedSource() {
  return {
    kind: "managed-project",
    open: vi.fn(async (projectId: string) => {
      if (projectId === "missing") throw new Error("Managed project does not exist");
      return {
        name: "Managed",
        projectId,
        projectPath: `/managed/${projectId}/app-store-screenshots.json`,
        capabilities: {
          writeInPlace: true,
          revealLocation: false,
          watchExternalChanges: false,
          nativePicker: false,
          projectLocalResources: true,
        },
      };
    }),
  } satisfies { kind: string; open(projectId: string): Promise<unknown> };
}

describe("ProjectSessionRegistry", () => {
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
        capabilities: {
          writeInPlace: true,
          revealLocation: false,
          watchExternalChanges: false,
          nativePicker: false,
          projectLocalResources: true,
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
