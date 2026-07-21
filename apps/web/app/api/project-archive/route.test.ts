// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectSessionRegistry } from "@web/lib/project-session.server.js";
import { handleProjectArchivePost } from "@web/app/api/project-archive/handler.js";
import { POST } from "@web/app/api/project-archive/route.js";

let root: string;

function managedRegistry() {
  return new ProjectSessionRegistry({
    createSessionId: () => "managed-session",
    managedSource: {
      kind: "managed-project",
      open: vi.fn(async (projectId: string) => ({
        name: "Managed",
        projectId,
        projectPath: "/private/managed/app-store-screenshots.json",
        lifecycleRevision: 1,
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
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "project-archive-route-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("POST /api/project-archive", () => {
  it("creates a separate archive ticket for an active managed project and disposes the source", async () => {
    const registry = managedRegistry();
    const session = registry.openManagedRecord({
      id: "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      name: "Managed",
      projectDirectory: "/private/managed",
      projectPath: "/private/managed/app-store-screenshots.json",
      lifecycleRevision: 1,
    });
    const archivePath = join(root, "archive.zip");
    await writeFile(archivePath, "zip");
    const dispose = vi.fn(async () => undefined);
    const createArchive = vi.fn(async () => ({
      path: archivePath,
      filename: "screenshot-studio-project.zip",
      projectRevision: "1".repeat(64),
      dispose,
    }));
    const stageArtifact = vi.fn(async () => ({
      downloadUrl: "/api/project-archive/artifacts/token",
      expiresAt: "2026-07-18T21:00:00.000Z",
      filename: "screenshot-studio-project.zip" as const,
    }));
    const request = new Request("http://localhost/api/project-archive", {
      method: "POST",
      headers: {
        cookie: `screenshot_studio_project_session=${session.descriptor.sessionId}`,
        "if-match": `"${"1".repeat(64)}"`,
        "x-project-id": session.projectId,
      },
    });

    const response = await handleProjectArchivePost(request, {
      session: { registry, configuredPath: () => null },
      managedReadGuard: (_session, operation) => operation(),
      createArchive,
      stageArtifact,
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      downloadUrl: "/api/project-archive/artifacts/token",
      expiresAt: "2026-07-18T21:00:00.000Z",
      filename: "screenshot-studio-project.zip",
      projectRevision: "1".repeat(64),
    });
    expect(createArchive).toHaveBeenCalledWith(session.projectId, undefined);
    expect(stageArtifact).toHaveBeenCalledWith(archivePath);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("requires the Project Home identity and rejects a stale project before archiving", async () => {
    const registry = managedRegistry();
    const session = registry.openManagedRecord({
      id: "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      name: "Managed",
      projectDirectory: "/private/managed",
      projectPath: "/private/managed/app-store-screenshots.json",
      lifecycleRevision: 1,
    });
    const createArchive = vi.fn();
    const cookie = `screenshot_studio_project_session=${session.descriptor.sessionId}`;

    const missing = await handleProjectArchivePost(new Request(
      "http://localhost/api/project-archive",
      { method: "POST", headers: { cookie } },
    ), { session: { registry, configuredPath: () => null }, createArchive });
    const stale = await handleProjectArchivePost(new Request(
      "http://localhost/api/project-archive",
      { method: "POST", headers: { cookie, "x-project-id": "stale-project" } },
    ), { session: { registry, configuredPath: () => null }, createArchive });

    expect(missing.status).toBe(428);
    expect(stale.status).toBe(409);
    expect(createArchive).not.toHaveBeenCalled();
  });

  it("rejects local-file sessions without generating an archive", async () => {
    const registry = new ProjectSessionRegistry({
      createSessionId: () => "local-session",
      localSource: {
        kind: "local-file",
        open: vi.fn(async () => ({
          name: "Local",
          projectId: "local",
          projectPath: "/local/app-store-screenshots.json",
          displayLocation: "/local/app-store-screenshots.json",
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
      },
    });
    const session = await registry.openLocal("local");
    const createArchive = vi.fn();
    const response = await handleProjectArchivePost(new Request(
      "http://localhost/api/project-archive",
      { method: "POST", headers: {
        cookie: `screenshot_studio_project_session=${session.descriptor.sessionId}`,
        "if-match": `"${"1".repeat(64)}"`,
        "x-project-id": session.projectId,
      } },
    ), {
      session: { registry, configuredPath: () => null },
      createArchive,
    });

    expect(response.status).toBe(409);
    expect(createArchive).not.toHaveBeenCalled();
  });

  it("refuses to stage an archive whose exact Project bytes do not match If-Match", async () => {
    const registry = managedRegistry();
    const session = registry.openManagedRecord({
      id: "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      name: "Managed",
      projectDirectory: "/private/managed",
      projectPath: "/private/managed/app-store-screenshots.json",
      lifecycleRevision: 1,
    });
    const dispose = vi.fn(async () => undefined);
    const stageArtifact = vi.fn();
    const response = await handleProjectArchivePost(new Request(
      "http://localhost/api/project-archive",
      { method: "POST", headers: {
        cookie: `screenshot_studio_project_session=${session.descriptor.sessionId}`,
        "if-match": `"${"1".repeat(64)}"`,
        "x-project-id": session.projectId,
      } },
    ), {
      session: { registry, configuredPath: () => null },
      managedReadGuard: (_session, operation) => operation(),
      createArchive: vi.fn(async () => ({
        path: join(root, "archive.zip"),
        filename: "screenshot-studio-project.zip",
        projectRevision: "2".repeat(64),
        dispose,
      })),
      stageArtifact,
    });

    expect(response.status).toBe(412);
    expect(stageArtifact).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("disposes a generated temporary archive when artifact staging fails", async () => {
    const registry = managedRegistry();
    const session = registry.openManagedRecord({
      id: "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      name: "Managed",
      projectDirectory: "/private/managed",
      projectPath: "/private/managed/app-store-screenshots.json",
      lifecycleRevision: 1,
    });
    const dispose = vi.fn(async () => undefined);
    const response = await handleProjectArchivePost(new Request(
      "http://localhost/api/project-archive",
      { method: "POST", headers: {
        cookie: `screenshot_studio_project_session=${session.descriptor.sessionId}`,
        "if-match": `"${"1".repeat(64)}"`,
        "x-project-id": session.projectId,
      } },
    ), {
      session: { registry, configuredPath: () => null },
      managedReadGuard: (_session, operation) => operation(),
      createArchive: vi.fn(async () => ({
        path: join(root, "archive.zip"),
        filename: "screenshot-studio-project.zip",
        projectRevision: "1".repeat(64),
        dispose,
      })),
      stageArtifact: vi.fn(async () => { throw new Error("private path"); }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Project archive export failed",
      code: "archive-failed",
    });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("wires the node route", () => {
    expect(POST).toBeTypeOf("function");
  });
});
