// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { projectRevision } from "@screenshot-studio/core/storage";
import {
  PROJECT_SESSION_COOKIE,
  projectSessionRegistry,
} from "@web/lib/project-session.server.js";
import { handleAssetPost } from "@web/app/api/assets/handler.js";
import { GET, POST } from "@web/app/api/assets/route.js";

const validProject = {
  meta: { name: "Assets", schemaVersion: 1 },
  fonts: [],
  preferredExportLayoutId: "primary",
  layouts: [{
    id: "primary",
    name: "Primary",
    mode: "isolated",
    screens: [{
      id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
      artboard: { width: 660, height: 1434 },
      background: { type: "solid", color: "#111111" }, elements: [],
    }],
  }],
};

function projectJson(name = "Assets"): string {
  return JSON.stringify({
    ...validProject,
    meta: { ...validProject.meta, name },
  });
}

let directory: string;
let projectPath: string;
let imageBytes: Buffer;
let sessionId: string | undefined;
let sessionProjectId: string | undefined;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "asset-route-"));
  projectPath = join(directory, "app-store-screenshots.json");
  process.env.PROJECT_PATH = projectPath;
  await writeFile(projectPath, projectJson());
  await mkdir(join(directory, "assets"), { recursive: true });
  await writeFile(join(directory, "assets", "shot.png"), "image");
  imageBytes = await readFile(new URL("../../../../../fixtures/sample/assets/demo-logistics-app.png", import.meta.url));
});

afterEach(async () => {
  if (sessionId && sessionProjectId) projectSessionRegistry.close(sessionId, sessionProjectId);
  sessionId = undefined;
  sessionProjectId = undefined;
  delete process.env.PROJECT_PATH;
  await rm(directory, { recursive: true, force: true });
});

function uploadRequest(name = "Finder capture.png", bytes: Uint8Array = imageBytes): Request {
  const form = new FormData();
  form.set("file", new Blob([Uint8Array.from(bytes).buffer], { type: "image/png" }), name);
  return new Request("http://localhost/api/assets", { method: "POST", body: form });
}

describe("/api/assets", () => {
  it("imports a valid local image into project-owned assets without changing project JSON", async () => {
    const before = await readFile(projectPath);
    const response = await handleAssetPost(
      projectPath,
      uploadRequest(),
      {},
      projectRevision(before),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("etag")).toBe(`"${projectRevision(before)}"`);
    expect(await response.json()).toEqual({
      asset: {
        path: "assets/imported/Finder-capture.png",
        name: "Finder-capture.png",
        source: "assets",
      },
    });
    expect(await readFile(join(directory, "assets/imported/Finder-capture.png"))).toEqual(imageBytes);
    expect(await readFile(projectPath)).toEqual(before);
  });

  it("rejects undecodable bytes and a stale project revision without publishing", async () => {
    const invalid = await handleAssetPost(
      projectPath,
      uploadRequest("invalid.png", new TextEncoder().encode("not an image")),
    );
    expect(invalid.status).toBe(400);

    const stale = await handleAssetPost(
      projectPath,
      uploadRequest("stale.png"),
      {},
      "stale-revision",
    );
    expect(stale.status).toBe(412);
    await expect(readFile(join(directory, "assets/imported/invalid.png")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(directory, "assets/imported/stale.png")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fences upload and listing to the cookie-selected project session", async () => {
    const session = await projectSessionRegistry.openLocal(projectPath);
    sessionId = session.descriptor.sessionId;
    sessionProjectId = session.projectId;
    process.env.PROJECT_PATH = join(directory, "configured-missing.json");
    const cookie = `${PROJECT_SESSION_COOKIE}=${encodeURIComponent(session.descriptor.sessionId)}`;
    const upload = uploadRequest();

    const imported = await POST(new Request(upload.url, {
      method: "POST",
      headers: {
        ...Object.fromEntries(upload.headers),
        cookie,
        "if-match": `"${projectRevision(await readFile(projectPath))}"`,
        "x-project-id": session.projectId,
      },
      body: await upload.arrayBuffer(),
    }));
    expect(imported.status).toBe(201);

    const listed = await GET(new Request("http://localhost/api/assets", {
      headers: { cookie, "x-project-id": session.projectId },
    }));
    expect(listed.status).toBe(200);
    expect((await listed.json()).assets).toContainEqual({
      path: "assets/imported/Finder-capture.png",
      name: "Finder-capture.png",
      source: "assets",
    });
  });
});

describe("GET /api/assets", () => {
  it("rejects a stale workspace identity after the session cookie changes", async () => {
    const staleWorkspace = await projectSessionRegistry.openLocal(projectPath);
    const activeDirectory = await mkdtemp(join(tmpdir(), "assets-route-active-"));
    const activeProjectPath = join(activeDirectory, "app-store-screenshots.json");
    await writeFile(activeProjectPath, projectJson("Active"));
    await mkdir(join(activeDirectory, "assets"), { recursive: true });
    await writeFile(join(activeDirectory, "assets", "active.png"), "image");

    try {
      const activeSession = await projectSessionRegistry.openLocal(activeProjectPath);
      const response = await GET(new Request("http://x/api/assets", {
        headers: {
          cookie: `${PROJECT_SESSION_COOKIE}=${activeSession.descriptor.sessionId}`,
          "x-project-id": staleWorkspace.projectId,
        },
      }));

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: expect.stringMatching(/changed/i) });
    } finally {
      await rm(activeDirectory, { recursive: true, force: true });
    }
  });

  it("requires the loaded workspace identity when a project session exists", async () => {
    const session = await projectSessionRegistry.openLocal(projectPath);

    const response = await GET(new Request("http://x/api/assets", {
      headers: { cookie: `${PROJECT_SESSION_COOKIE}=${session.descriptor.sessionId}` },
    }));

    expect(response.status).toBe(428);
  });

  it("lists assets through each request's active project session", async () => {
    const first = await projectSessionRegistry.openLocal(projectPath);
    const secondDirectory = await mkdtemp(join(tmpdir(), "assets-route-second-"));
    const secondProjectPath = join(secondDirectory, "app-store-screenshots.json");
    await writeFile(secondProjectPath, projectJson("Second"));
    await mkdir(join(secondDirectory, "assets"), { recursive: true });
    await writeFile(join(secondDirectory, "assets", "second.png"), "image");

    try {
      const firstResponse = await GET(new Request("http://x/api/assets", {
        headers: {
          cookie: `${PROJECT_SESSION_COOKIE}=${first.descriptor.sessionId}`,
          "x-project-id": first.projectId,
        },
      }));
      const second = await projectSessionRegistry.openLocal(secondProjectPath);
      const secondResponse = await GET(new Request("http://x/api/assets", {
        headers: {
          cookie: `${PROJECT_SESSION_COOKIE}=${second.descriptor.sessionId}`,
          "x-project-id": second.projectId,
        },
      }));

      expect(await firstResponse.json()).toEqual({
        assets: [{ path: "assets/shot.png", name: "shot.png", source: "assets" }],
      });
      expect(await secondResponse.json()).toEqual({
        assets: [{ path: "assets/second.png", name: "second.png", source: "assets" }],
      });
    } finally {
      await rm(secondDirectory, { recursive: true, force: true });
    }
  });

  it("returns 409 without a selected or configured project", async () => {
    delete process.env.PROJECT_PATH;

    expect((await GET(new Request("http://x/api/assets"))).status).toBe(409);
  });

  it("returns safe project image descriptors", async () => {
    const session = await projectSessionRegistry.openLocal(projectPath);
    const response = await GET(new Request("http://x/api/assets", {
      headers: { "x-project-id": session.projectId },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      assets: [{ path: "assets/shot.png", name: "shot.png", source: "assets" }],
    });
  });
});
