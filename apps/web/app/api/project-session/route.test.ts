// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ProjectSessionRegistry,
  type ActiveProjectResolverDependencies,
} from "@web/lib/project-session.server.js";
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

function dependencies(): ActiveProjectResolverDependencies {
  return {
    registry: new ProjectSessionRegistry({ createSessionId: () => "session-1" }),
    configuredPath: () => null,
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

  it("leaves stale selection cookie-neutral and bootstraps an explicit configured path", async () => {
    const projectPath = await createProject("Launcher");
    const registry = new ProjectSessionRegistry({ createSessionId: () => "session-1" });
    const stale = await handleProjectSessionGet(new Request(
      "http://localhost/api/project-session",
      { headers: { cookie: "screenshot_studio_project_session=missing" } },
    ), { registry, configuredPath: () => null });

    expect(stale.status).toBe(204);
    expect(stale.headers.get("set-cookie")).toBeNull();

    const configured = await handleProjectSessionGet(
      new Request("http://localhost/api/project-session"),
      { registry, configuredPath: () => projectPath },
    );
    expect(configured.status).toBe(200);
    expect(configured.headers.get("x-project-id")).toBeTruthy();
    expect(configured.headers.get("set-cookie")).toContain(
      "screenshot_studio_project_session=session-1",
    );
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
