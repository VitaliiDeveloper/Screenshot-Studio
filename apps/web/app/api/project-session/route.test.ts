// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagedProjectNotFoundError } from "@web/lib/managed-projects/managed-project-repository.server.js";
import {
  ProjectSessionRegistry,
} from "@web/lib/session/project-session.server.js";
import {
  handleProjectSessionDelete,
  handleProjectSessionGet,
} from "./handler.js";
import * as projectSessionRoute from "./route.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createProject(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "project-session-route-"));
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

function dependencies() {
  return {
    registry: new ProjectSessionRegistry({ createSessionId: () => "session-1" }),
    configuredPath: () => null,
    recentProjects: { record: async () => undefined },
  };
}

describe("project session route handlers", () => {
  it("does not expose browser local-path activation", () => {
    expect("POST" in projectSessionRoute).toBe(false);
    expect("DELETE" in projectSessionRoute).toBe(true);
  });

  it("returns a cookie-neutral 204 when a fresh client has no active or configured project", async () => {
    const response = await handleProjectSessionGet(
      new Request("http://localhost/api/project-session"),
      dependencies(),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("expires a stale managed recovery hint that cannot be reopened", async () => {
    const response = await handleProjectSessionGet(new Request(
      "http://localhost/api/project-session",
      {
        headers: {
          cookie: "screenshot_studio_managed_project=project_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      },
    ), {
      registry: new ProjectSessionRegistry({
        createSessionId: () => "unused-session",
        managedSource: {
          kind: "managed-project",
          open: async () => { throw new ManagedProjectNotFoundError(); },
        },
      }),
      configuredPath: () => null,
      recentProjects: { record: async () => undefined },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie") ?? "").toContain(
      "screenshot_studio_managed_project=;",
    );
    expect(response.headers.get("set-cookie") ?? "").toContain("Max-Age=0");
  });

  it("expires a malformed managed recovery hint", async () => {
    const response = await handleProjectSessionGet(new Request(
      "http://localhost/api/project-session",
      {
        headers: {
          cookie: "screenshot_studio_managed_project=../../private",
        },
      },
    ), dependencies());

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie") ?? "").toContain(
      "screenshot_studio_managed_project=;",
    );
    expect(response.headers.get("set-cookie") ?? "").toContain("Max-Age=0");
  });

  it("retains the recovery hint when reopening fails for a reason other than missing", async () => {
    const response = await handleProjectSessionGet(new Request(
      "http://localhost/api/project-session",
      {
        headers: {
          cookie: "screenshot_studio_managed_project=project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      },
    ), {
      registry: new ProjectSessionRegistry({
        createSessionId: () => "unused-session",
        managedSource: {
          kind: "managed-project",
          open: async () => {
            throw new Error("EACCES: lstat '/private/managed-root/catalog.json'");
          },
        },
      }),
      configuredPath: () => null,
      recentProjects: { record: async () => undefined },
    });

    expect(response.status).toBe(500);
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: "Unable to reopen the managed project",
    });
  });

  it("leaves stale selection cookie-neutral and bootstraps an explicit configured path", async () => {
    const projectPath = await createProject("Launcher");
    const registry = new ProjectSessionRegistry({ createSessionId: () => "session-1" });
    const stale = await handleProjectSessionGet(new Request(
      "http://localhost/api/project-session",
      { headers: { cookie: "screenshot_studio_project_session=missing" } },
    ), { registry, configuredPath: () => null, recentProjects: { record: async () => undefined } });

    expect(stale.status).toBe(204);
    expect(stale.headers.get("set-cookie")).toBeNull();

    const configured = await handleProjectSessionGet(
      new Request("http://localhost/api/project-session"),
      { registry, configuredPath: () => projectPath, recentProjects: { record: async () => undefined } },
    );
    expect(configured.status).toBe(200);
    expect(configured.headers.get("x-project-id")).toBeTruthy();
    expect(configured.headers.get("set-cookie")).toContain(
      "screenshot_studio_project_session=session-1",
    );
    expect(configured.headers.get("set-cookie")).toContain(
      "screenshot_studio_managed_project=;",
    );
  });

  it("durably records a successfully resolved source without letting history failure block activation", async () => {
    const projectPath = await createProject("Recorded local source");
    const registry = new ProjectSessionRegistry({ createSessionId: () => "session-recorded" });
    const record = vi.fn(async () => { throw new Error("recent history unavailable"); });

    const response = await handleProjectSessionGet(
      new Request("http://localhost/api/project-session"),
      { registry, configuredPath: () => projectPath, recentProjects: { record } },
    );

    expect(response.status).toBe(200);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      descriptor: expect.objectContaining({ sourceKind: "local-file" }),
    }));
    expect(response.headers.get("set-cookie")).toContain(
      "screenshot_studio_project_session=session-recorded",
    );
  });

  it("does not re-add an active project to recents during an ordinary session lookup", async () => {
    const projectPath = await createProject("Removed active recent");
    const registry = new ProjectSessionRegistry({ createSessionId: () => "session-existing" });
    await registry.openLocal(projectPath);
    const record = vi.fn(async () => undefined);

    const response = await handleProjectSessionGet(new Request(
      "http://localhost/api/project-session",
      { headers: { cookie: "screenshot_studio_project_session=session-existing" } },
    ), { registry, configuredPath: () => null, recentProjects: { record } });

    expect(response.status).toBe(200);
    expect(record).not.toHaveBeenCalled();
  });

  it("rehydrates a managed project and refreshes both activation cookies", async () => {
    const projectId = "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const registry = new ProjectSessionRegistry({
      createSessionId: () => "recovered-session",
      managedSource: {
        kind: "managed-project",
        open: async (requestedId: string) => ({
          name: "Recovered",
          projectId: requestedId,
          projectPath: "/private/managed/app-store-screenshots.json",
          capabilities: {
            writeInPlace: true,
            revealLocation: false,
            watchExternalChanges: false,
            nativePicker: false,
            projectLocalResources: true,
            exportProjectArchive: true,
        deleteProjectPermanently: true,
          },
        }),
      },
    });

    const response = await handleProjectSessionGet(new Request(
      "https://localhost/api/project-session",
      { headers: { cookie: `screenshot_studio_managed_project=${projectId}` } },
    ), { registry, configuredPath: () => null, recentProjects: { record: async () => undefined } });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-project-id")).toBe(projectId);
    expect(response.headers.get("set-cookie")).toContain(
      "screenshot_studio_project_session=recovered-session",
    );
    expect(response.headers.get("set-cookie")).toContain(
      `screenshot_studio_managed_project=${projectId}`,
    );
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it("closes only the identity-fenced active session and expires its cookie", async () => {
    const firstPath = await createProject("First");
    const secondPath = await createProject("Second");
    let nextSessionId = 0;
    const registry = new ProjectSessionRegistry({
      createSessionId: () => `session-${++nextSessionId}`,
    });
    const first = await registry.openLocal(firstPath);
    const second = await registry.openLocal(secondPath);

    const response = await handleProjectSessionDelete(new Request(
      "https://localhost/api/project-session",
      {
        method: "DELETE",
        headers: {
          cookie: `screenshot_studio_project_session=${first.descriptor.sessionId}`,
          "x-project-id": first.projectId,
        },
      },
    ), { registry, configuredPath: () => { throw new Error("must not bootstrap"); } });

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(response.headers.get("set-cookie")).toContain(
      "screenshot_studio_managed_project=;",
    );
    expect(registry.get(first.descriptor.sessionId)).toBeUndefined();
    expect(registry.get(second.descriptor.sessionId)).toBe(second);
  });

  it("keeps the active session when the close project identity is missing or stale", async () => {
    const path = await createProject("Identity fence");
    const registry = new ProjectSessionRegistry({ createSessionId: () => "session-1" });
    const session = await registry.openLocal(path);
    const base = {
      method: "DELETE",
      headers: { cookie: "screenshot_studio_project_session=session-1" },
    };

    const missing = await handleProjectSessionDelete(
      new Request("http://localhost/api/project-session", base),
      { registry, configuredPath: () => null },
    );
    const stale = await handleProjectSessionDelete(new Request(
      "http://localhost/api/project-session",
      { ...base, headers: { ...base.headers, "x-project-id": "another-project" } },
    ), { registry, configuredPath: () => null });

    expect(missing.status).toBe(428);
    expect(stale.status).toBe(409);
    expect(registry.get(session.descriptor.sessionId)).toBe(session);
  });
});
