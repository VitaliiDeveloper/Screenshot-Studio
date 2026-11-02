// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveManagedProjectStorageConfig } from "@web/lib/managed-projects/managed-project-config.server.js";
import { acquireManagedProjectLifecycleLock } from "@web/lib/managed-projects/managed-project-lifecycle-lock.server.js";
import { withManagedProjectReadGuard } from "@web/lib/managed-projects/managed-project-mutation-guard.server.js";
import { ManagedProjectRepository } from "@web/lib/managed-projects/managed-project-repository.server.js";
import { StorageLockTimeoutError } from "@web/lib/storage-lock.server.js";
import {
  withProjectMutationRequest,
  withProjectReadRequest,
  withProjectVersionedReadRequest,
} from "./project-request-fence.server.js";
import {
  PROJECT_SESSION_COOKIE,
  ProjectSessionRegistry,
  type ProjectSession,
} from "./project-session.server.js";

const REVISION = "\"revision\"";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function managedFixture() {
  const root = await mkdtemp(join(tmpdir(), "project-request-fence-"));
  roots.push(root);
  const config = resolveManagedProjectStorageConfig({ SCREENSHOT_STUDIO_DATA_ROOT: root });
  const repository = new ManagedProjectRepository(config);
  const stage = await repository.createStage();
  await writeFile(join(stage.path, "app-store-screenshots.json"), JSON.stringify({
    meta: { name: "Fenced", schemaVersion: 1 }, fonts: [], preferredExportLayoutId: "primary",
    layouts: [{ id: "primary", name: "Primary", mode: "isolated", screens: [{
      id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
      artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#000000" }, elements: [],
    }] }],
  }));
  const project = await repository.publishStage({ token: stage.token });
  const session = {
    descriptor: {
      sessionId: "session", name: project.name, sourceKind: "managed-project", lifecycleRevision: 1, capabilities: {},
    },
    projectId: project.id,
    projectPath: project.projectPath,
  } as ProjectSession;
  const registry = {
    get: () => session,
    peek: () => session,
    revalidateManagedSession: async (current: ProjectSession) => current,
  } as unknown as ProjectSessionRegistry;
  const request = new Request("http://localhost/api/test", {
    headers: {
      cookie: `${PROJECT_SESSION_COOKIE}=session`,
      "x-project-id": project.id,
      "if-match": REVISION,
    },
  });
  return { config, project, session, registry, request };
}

const wrappers = [
  ["withProjectReadRequest", withProjectReadRequest],
  ["withProjectVersionedReadRequest", withProjectVersionedReadRequest],
  ["withProjectMutationRequest", withProjectMutationRequest],
] as const;

describe("project request fence errors", () => {
  it.each(wrappers)("%s answers 409 when the guard finds a changed lifecycle", async (_name, wrapper) => {
    const { config, session, registry, request } = await managedFixture();
    session.descriptor.lifecycleRevision = 99;
    const operation = vi.fn(async () => new Response("reached"));

    const response = await wrapper(request, operation, { registry, managedStorageConfig: config });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "lifecycle-changed",
      error: expect.stringContaining("reload"),
    });
    expect(operation).not.toHaveBeenCalled();
  });

  it.each(wrappers.slice(0, 2))("%s answers 423 while another owner holds the lifecycle lock", async (_name, wrapper) => {
    const { config, project, registry, request } = await managedFixture();
    const owner = await acquireManagedProjectLifecycleLock(config, project.id);
    const managedReadGuard: typeof withManagedProjectReadGuard = (session, operation, dependencies) =>
      withManagedProjectReadGuard(session, operation, { ...dependencies, lockOptions: { timeoutMs: 0 } });

    const response = await wrapper(request, async () => new Response("reached"), {
      registry,
      managedStorageConfig: config,
      managedReadGuard,
    });
    await owner.release();

    expect(response.status).toBe(423);
    const body = await response.json() as { code: string; error: string };
    expect(body).toMatchObject({ code: "project-busy", error: expect.stringContaining("busy") });
    expect(body.error).not.toContain(project.id);
  });

  it("leaves other failures to the caller", async () => {
    const { registry, request } = await managedFixture();
    const managedReadGuard = (async () => { throw new Error("disk failed"); }) as typeof withManagedProjectReadGuard;

    await expect(withProjectReadRequest(request, async () => new Response("reached"), { registry, managedReadGuard }))
      .rejects.toThrow("disk failed");
  });

  it.each([
    ["withProjectReadRequest", withProjectReadRequest],
    ["withProjectVersionedReadRequest", withProjectVersionedReadRequest],
  ] as const)("%s answers 423 when session revalidation times out on the lifecycle lock", async (_name, wrapper) => {
    const { project, request } = await managedFixture();
    // The shared registry can hold a source from another route bundle, so its error class is a foreign copy.
    class ForeignCopy extends Error { override name = StorageLockTimeoutError.name; }
    const open = vi.fn(async () => {
      if (open.mock.calls.length > 1) throw new ForeignCopy("Timed out");
      return {
        name: "Fenced",
        projectId: project.id,
        projectPath: project.projectPath,
        lifecycleRevision: 1,
        capabilities: { deleteProjectPermanently: true },
      };
    });
    const registry = new ProjectSessionRegistry({
      createSessionId: () => "session",
      managedSource: { kind: "managed-project", open } as never,
    });
    await registry.openManaged(project.id);

    const operation = vi.fn(async () => new Response("reached"));
    const response = await wrapper(request, operation, { registry });

    expect(response.status).toBe(423);
    expect(await response.json()).toMatchObject({ code: "project-busy" });
    expect(operation).not.toHaveBeenCalled();
  });
});
