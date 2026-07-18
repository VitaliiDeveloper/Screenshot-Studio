// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROJECT_SESSION_COOKIE,
  projectSessionRegistry,
} from "../../../lib/project-session.server.js";
import { GET } from "./route.js";

let directory: string;

function projectJson(name = "Assets"): string {
  return JSON.stringify({
    meta: { name, schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "primary",
    layouts: [{
      id: "primary",
      name: "Primary",
      mode: "isolated",
      screens: [{
        id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
        artboard: { width: 660, height: 1434 },
        background: { type: "solid", color: "#000000" },
        elements: [],
      }],
    }],
  });
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "assets-route-"));
  process.env.PROJECT_PATH = join(directory, "app-store-screenshots.json");
  await writeFile(process.env.PROJECT_PATH, projectJson());
  await mkdir(join(directory, "assets"), { recursive: true });
  await writeFile(join(directory, "assets", "shot.png"), "image");
});

afterEach(async () => {
  delete process.env.PROJECT_PATH;
  await rm(directory, { recursive: true, force: true });
});

describe("GET /api/assets", () => {
  it("rejects a stale workspace identity after the session cookie changes", async () => {
    const staleWorkspace = await projectSessionRegistry.openLocal(process.env.PROJECT_PATH!);
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
    const session = await projectSessionRegistry.openLocal(process.env.PROJECT_PATH!);

    const response = await GET(new Request("http://x/api/assets", {
      headers: { cookie: `${PROJECT_SESSION_COOKIE}=${session.descriptor.sessionId}` },
    }));

    expect(response.status).toBe(428);
  });

  it("lists assets through each request's active project session", async () => {
    const first = await projectSessionRegistry.openLocal(process.env.PROJECT_PATH!);
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
    const session = await projectSessionRegistry.openLocal(process.env.PROJECT_PATH!);
    const response = await GET(new Request("http://x/api/assets", {
      headers: { "x-project-id": session.projectId },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      assets: [{ path: "assets/shot.png", name: "shot.png", source: "assets" }],
    });
  });
});
