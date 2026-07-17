// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ProjectSessionRegistry,
  type ActiveProjectResolverDependencies,
} from "../../../lib/project-session.server.js";
import {
  handleProjectSessionGet,
  handleProjectSessionPost,
} from "./handler.js";

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
  it("returns 204 when no project is active or configured", async () => {
    const response = await handleProjectSessionGet(
      new Request("http://localhost/api/project-session"),
      dependencies(),
    );

    expect(response.status).toBe(204);
  });

  it("opens a valid path and sets the active cookie", async () => {
    const projectPath = await createProject("Launcher");
    const response = await handleProjectSessionPost(new Request(
      "http://localhost/api/project-session",
      { method: "POST", body: JSON.stringify({ path: projectPath }) },
    ), dependencies());

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(
      "screenshot_studio_project_session=session-1",
    );
    expect(await response.json()).toMatchObject({
      sessionId: "session-1",
      name: "Launcher",
      sourceKind: "local-file",
    });
  });

  it("keeps the existing selection when an open is rejected", async () => {
    const projectPath = await createProject("Launcher");
    const invalidRoot = await mkdtemp(join(tmpdir(), "project-session-invalid-"));
    temporaryRoots.push(invalidRoot);
    const invalidPath = join(invalidRoot, "app-store-screenshots.json");
    await writeFile(invalidPath, "not JSON");
    const testDependencies = dependencies();
    const validRequest = new Request("http://localhost/api/project-session", {
      method: "POST",
      body: JSON.stringify({ path: projectPath }),
    });
    const opened = await handleProjectSessionPost(validRequest, testDependencies);
    const cookie = opened.headers.get("set-cookie")!.split(";", 1)[0]!;
    const rejected = await handleProjectSessionPost(new Request(
      "http://localhost/api/project-session",
      { method: "POST", headers: { cookie }, body: JSON.stringify({ path: invalidPath }) },
    ), testDependencies);

    expect(rejected.status).toBe(422);
    expect(rejected.headers.get("set-cookie")).toBeNull();

    const current = await handleProjectSessionGet(new Request(
      "http://localhost/api/project-session",
      { headers: { cookie } },
    ), testDependencies);
    expect((await current.json()).sessionId).toBe("session-1");
  });

  it("rejects malformed post bodies without setting a cookie", async () => {
    for (const body of ["", "null", "[]", "{}", JSON.stringify({ path: " " })]) {
      const response = await handleProjectSessionPost(new Request(
        "http://localhost/api/project-session",
        { method: "POST", body },
      ), dependencies());
      expect(response.status).toBe(400);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  it("clears stale selection and bootstraps an explicit configured path", async () => {
    const projectPath = await createProject("Launcher");
    const registry = new ProjectSessionRegistry({ createSessionId: () => "session-1" });
    const stale = await handleProjectSessionGet(new Request(
      "http://localhost/api/project-session",
      { headers: { cookie: "screenshot_studio_project_session=missing" } },
    ), { registry, configuredPath: () => null });

    expect(stale.status).toBe(204);
    expect(stale.headers.get("set-cookie")).toContain("Max-Age=0");

    const configured = await handleProjectSessionGet(
      new Request("http://localhost/api/project-session"),
      { registry, configuredPath: () => projectPath },
    );
    expect(configured.status).toBe(200);
    expect(configured.headers.get("set-cookie")).toContain(
      "screenshot_studio_project_session=session-1",
    );
  });
});
