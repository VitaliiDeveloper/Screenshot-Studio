// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdtempSync, rmSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROJECT_ASSET_EXTENSIONS } from "@screenshot-studio/core/model";
import {
  PROJECT_SESSION_COOKIE,
  projectSessionRegistry,
} from "@web/lib/session/project-session.server.js";
import { GET } from "./route.js";

let dir: string;
let projectFile: string;
let outsideDir: string;

function projectJson(name = "Asset"): string {
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "asset-"));
  projectFile = join(dir, "app-store-screenshots.json");
  writeFileSync(projectFile, projectJson());
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "assets", "shot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  mkdirSync(join(dir, "assets", "fonts"), { recursive: true });
  for (const ext of ["ttf", "otf", "woff", "woff2"]) {
    writeFileSync(join(dir, "assets", "fonts", `demo.${ext}`), Buffer.from([0x00, 0x01]));
  }
  process.env.PROJECT_PATH = projectFile;
  outsideDir = mkdtempSync(join(tmpdir(), "asset-outside-"));
});

afterEach(() => {
  delete process.env.PROJECT_PATH;
  rmSync(dir, { recursive: true, force: true });
  rmSync(outsideDir, { recursive: true, force: true });
});

function cookieFor(sessionId: string): string {
  return `${PROJECT_SESSION_COOKIE}=${encodeURIComponent(sessionId)}`;
}

function scopedRequest(
  projectId: string,
  sessionId: string,
  path: string | null,
  revision = '"revision-1"',
): Request {
  const query = new URLSearchParams({ projectId, revision });
  if (path !== null) query.set("path", path);
  return new Request(`http://x/api/asset?${query}`, {
    headers: { cookie: cookieFor(sessionId) },
  });
}

function explicitRequest(path: string, host = "127.0.0.1:3000"): Request {
  const query = new URLSearchParams({ project: projectFile, path });
  return new Request(`http://${host}/api/asset?${query}`);
}

async function activeRequest(path: string | null): Promise<Request> {
  const session = await projectSessionRegistry.openLocal(projectFile);
  return scopedRequest(session.projectId, session.descriptor.sessionId, path);
}

describe("GET /api/asset", () => {
  it("resolves assets through each request's active project session", async () => {
    const first = await projectSessionRegistry.openLocal(projectFile);
    const secondDir = mkdtempSync(join(tmpdir(), "asset-second-"));
    const secondProject = join(secondDir, "app-store-screenshots.json");
    mkdirSync(join(secondDir, "assets"), { recursive: true });
    writeFileSync(secondProject, projectJson("Second"));
    writeFileSync(join(secondDir, "assets", "shot.png"), Buffer.from([0x42]));

    try {
      const firstResponse = await GET(scopedRequest(
        first.projectId,
        first.descriptor.sessionId,
        "assets/shot.png",
      ));
      const second = await projectSessionRegistry.openLocal(secondProject);
      const secondResponse = await GET(scopedRequest(
        second.projectId,
        second.descriptor.sessionId,
        "assets/shot.png",
      ));

      expect(new Uint8Array(await firstResponse.arrayBuffer())[0]).toBe(0x89);
      expect(new Uint8Array(await secondResponse.arrayBuffer())[0]).toBe(0x42);
    } finally {
      rmSync(secondDir, { recursive: true, force: true });
    }
  });

  it("rejects an old project-scoped URL instead of serving the active project's bytes", async () => {
    const first = await projectSessionRegistry.openLocal(projectFile);
    const secondDir = mkdtempSync(join(tmpdir(), "asset-second-"));
    const secondProject = join(secondDir, "app-store-screenshots.json");
    mkdirSync(join(secondDir, "assets"), { recursive: true });
    writeFileSync(secondProject, projectJson("Second"));
    writeFileSync(join(secondDir, "assets", "shot.png"), Buffer.from([0x42]));
    const second = await projectSessionRegistry.openLocal(secondProject);

    try {
      const response = await GET(scopedRequest(
        first.projectId,
        second.descriptor.sessionId,
        "assets/shot.png",
      ));

      expect(response.status).toBe(409);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(new Uint8Array(await response.arrayBuffer())[0]).not.toBe(0x42);
    } finally {
      rmSync(secondDir, { recursive: true, force: true });
    }
  });

  it("returns 409 without a selected or configured project", async () => {
    delete process.env.PROJECT_PATH;

    expect((await GET(new Request("http://x/api/asset?path=assets/shot.png"))).status).toBe(409);
  });

  it("keeps the explicit project override for headless rendering", async () => {
    delete process.env.PROJECT_PATH;

    const response = await GET(explicitRequest("assets/shot.png"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer())[0]).toBe(0x89);
  });

  it("rejects the explicit project override from a non-loopback Host", async () => {
    const response = await GET(explicitRequest("assets/shot.png", "evil.example:3000"));

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each(PROJECT_ASSET_EXTENSIONS)("serves every shared project asset extension: %s", async (extension) => {
    writeFileSync(join(dir, "assets", `file${extension}`), "bytes");

    const response = await GET(explicitRequest(`assets/file${extension}`));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^(image|font)\//);
  });

  it("does not serve a project file that is not an image or font", async () => {
    writeFileSync(join(dir, "assets", "notes.txt"), "secret");

    const response = await GET(explicitRequest("assets/notes.txt"));

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.not.toContain("secret");
    expect((await GET(explicitRequest("app-store-screenshots.json"))).status).toBe(404);
  });

  it("does not serve a non-image file behind an image-named symlink", async () => {
    writeFileSync(join(dir, "assets", "notes.txt"), "secret");
    symlinkSync(join(dir, "assets", "notes.txt"), join(dir, "assets", "alias.png"));

    expect((await GET(explicitRequest("assets/alias.png"))).status).toBe(404);
  });

  it("does not serve a directory with an image extension", async () => {
    mkdirSync(join(dir, "assets", "folder.png"));

    expect((await GET(explicitRequest("assets/folder.png"))).status).toBe(404);
  });

  it("rejects explicit-project traversal and symlink escapes", async () => {
    const outside = join(outsideDir, "outside.png");
    writeFileSync(outside, "outside");
    symlinkSync(outside, join(dir, "assets", "escape.png"));

    expect((await GET(explicitRequest("../../etc/passwd"))).status).toBe(400);
    expect((await GET(explicitRequest("assets/escape.png"))).status).toBe(400);
  });

  it("serves a scoped file under the project dir with private no-store semantics", async () => {
    const res = await GET(await activeRequest("assets/shot.png"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("vary")).toContain("Cookie");
    expect(new Uint8Array(await res.arrayBuffer())[0]).toBe(0x89);
  });

  it("rejects an unscoped interactive URL", async () => {
    const session = await projectSessionRegistry.openLocal(projectFile);
    const response = await GET(new Request("http://x/api/asset?path=assets/shot.png", {
      headers: { cookie: cookieFor(session.descriptor.sessionId) },
    }));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each([
    ["unquoted", "revision-1"],
    ["weak", 'W/"revision-1"'],
    ["control character", '"revision\n1"'],
  ])("rejects a %s interactive revision", async (_kind, revision) => {
    const session = await projectSessionRegistry.openLocal(projectFile);
    const response = await GET(scopedRequest(
      session.projectId,
      session.descriptor.sessionId,
      "assets/shot.png",
      revision,
    ));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "revision must be one strong quoted ETag",
    });
  });

  it("rejects an empty interactive revision", async () => {
    const session = await projectSessionRegistry.openLocal(projectFile);
    const response = await GET(scopedRequest(
      session.projectId,
      session.descriptor.sessionId,
      "assets/shot.png",
      "",
    ));

    expect(response.status).toBe(400);
  });

  it("400s on a missing path param", async () => {
    expect((await GET(await activeRequest(null))).status).toBe(400);
  });

  it("rejects path traversal outside the base dir", async () => {
    expect((await GET(await activeRequest("../../etc/passwd"))).status).toBe(400);
  });

  it("rejects a symlink escape outside the project", async () => {
    const outside = join(outsideDir, "outside.png");
    writeFileSync(outside, "outside");
    symlinkSync(outside, join(dir, "assets", "escape.png"));
    expect((await GET(await activeRequest("assets/escape.png"))).status).toBe(400);
  });

  it("404s a nonexistent file", async () => {
    expect((await GET(await activeRequest("assets/nope.png"))).status).toBe(404);
  });

  it("serves font files with font content types", async () => {
    expect((await GET(await activeRequest("assets/fonts/demo.ttf"))).headers.get("content-type")).toContain("font/ttf");
    expect((await GET(await activeRequest("assets/fonts/demo.otf"))).headers.get("content-type")).toContain("font/otf");
    expect((await GET(await activeRequest("assets/fonts/demo.woff"))).headers.get("content-type")).toContain("font/woff");
    expect((await GET(await activeRequest("assets/fonts/demo.woff2"))).headers.get("content-type")).toContain("font/woff2");
  });
});
