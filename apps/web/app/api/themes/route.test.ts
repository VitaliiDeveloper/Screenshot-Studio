// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectRevision } from "@screenshot-studio/core/storage";
import {
  PROJECT_SESSION_COOKIE,
  projectSessionRegistry,
} from "@web/lib/session/project-session.server.js";
import { handleThemeGet, handleThemePost } from "./handler.js";
import { GET, POST } from "./route.js";

let dir: string;
let projectPath: string;
const originalInitCwd = process.env.INIT_CWD;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "theme-route-"));
  projectPath = join(dir, "app-store-screenshots.json");
  await mkdir(join(dir, "themes"));
  await writeFile(projectPath, JSON.stringify({
    meta: { name: "Themes", schemaVersion: 1 }, fonts: [],
    preferredExportLayoutId: "primary",
    layouts: [{ id: "primary", name: "Primary", mode: "isolated", screens: [{ id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en", artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#111111" }, elements: [{ id: "accent", type: "shape", role: "accent", x: 0, y: 0, width: 100, height: 10, rotation: 0, opacity: 1, locked: false, visible: true, kind: "rect", fill: "#FFFFFF", radius: 0 }] }] }],
  }));
  await writeFile(join(dir, "themes/midnight.json"), JSON.stringify({
    id: "midnight", name: "Midnight",
    colors: { heading: "#F8FAFC", body: "#CBD5E1", accent: "#38BDF8", surface: "#0F172A" },
    fonts: {},
  }));
});

afterEach(async () => {
  delete process.env.PROJECT_PATH;
  if (originalInitCwd === undefined) delete process.env.INIT_CWD;
  else process.env.INIT_CWD = originalInitCwd;
  await rm(dir, { recursive: true, force: true });
});

describe("/api/themes", () => {
  it("lists definitions and applies one durably", async () => {
    const listed = await handleThemeGet(projectPath);
    expect(await listed.json()).toMatchObject({
      builtIns: [{ id: "neutral-default", name: "Neutral default" }],
      themes: [{ id: "midnight", name: "Midnight" }],
    });

    const response = await handleThemePost(projectPath, new Request("http://localhost/api/themes", {
      method: "POST",
      body: JSON.stringify({ id: "midnight" }),
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).layouts[0].screens[0].elements[0].fill).toBe("#38BDF8");
    const persisted = await readFile(projectPath);
    expect(JSON.parse(persisted.toString("utf8")).layouts[0].screens[0].elements[0].fill).toBe("#38BDF8");
    expect(response.headers.get("etag")).toBe(`"${projectRevision(persisted)}"`);
  });

  it("applies a global design pack as literals without copying resource files", async () => {
    const beforeEntries = await readdir(dir);
    const response = await handleThemePost(projectPath, new Request("http://localhost/api/themes", {
      method: "POST",
      body: JSON.stringify({ id: "neutral-default", source: "built-in" }),
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.layouts[0].screens[0].elements[0]).toMatchObject({ fill: "#2563EB", radius: 0 });
    const persisted = JSON.parse((await readFile(projectPath)).toString("utf8"));
    expect(JSON.stringify(persisted)).not.toContain("neutral-default");
    expect(await readdir(dir)).toEqual(beforeEntries);
  });

  it("returns explicit errors for missing and invalid ids", async () => {
    const nullBody = await handleThemePost(projectPath, new Request("http://localhost/api/themes", {
      method: "POST", body: "null",
    }));
    expect(nullBody.status).toBe(400);
    expect((await nullBody.json()).error).toMatch(/JSON object/i);

    const missing = await handleThemePost(projectPath, new Request("http://localhost/api/themes", {
      method: "POST", body: JSON.stringify({ id: "missing" }),
    }));
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-store");
    expect(Object.keys(await missing.json())).toEqual(["error"]);
    const invalid = await handleThemePost(projectPath, new Request("http://localhost/api/themes", {
      method: "POST", body: JSON.stringify({ id: "../bad" }),
    }));
    expect(invalid.status).toBe(400);
  });

  it("routes reads and mutations through the cookie-selected project session", async () => {
    const session = await projectSessionRegistry.openLocal(projectPath);
    process.env.PROJECT_PATH = join(dir, "configured-missing.json");
    const cookie = `${PROJECT_SESSION_COOKIE}=${encodeURIComponent(session.descriptor.sessionId)}`;
    const revision = projectRevision(await readFile(projectPath));

    const listed = await GET(new Request("http://localhost/api/themes", {
      headers: { cookie, "x-project-id": session.projectId },
    }));
    expect((await listed.json()).themes).toMatchObject([{ id: "midnight" }]);

    const applied = await POST(new Request("http://localhost/api/themes", {
      method: "POST",
      headers: {
        cookie,
        "if-match": `"${revision}"`,
        "x-project-id": session.projectId,
      },
      body: JSON.stringify({ id: "midnight" }),
    }));
    expect(applied.status).toBe(200);
    expect((await applied.json()).layouts[0].screens[0].elements[0].fill).toBe("#38BDF8");
  });

  it("rejects a stale project identity before applying a theme", async () => {
    const session = await projectSessionRegistry.openLocal(projectPath);
    const cookie = `${PROJECT_SESSION_COOKIE}=${encodeURIComponent(session.descriptor.sessionId)}`;
    const before = await readFile(projectPath);

    const response = await POST(new Request("http://localhost/api/themes", {
      method: "POST",
      headers: {
        cookie,
        "if-match": `"${projectRevision(before)}"`,
        "x-project-id": "stale-project",
      },
      body: JSON.stringify({ id: "midnight" }),
    }));

    expect(response.status).toBe(409);
    expect(await readFile(projectPath)).toEqual(before);
  });

  it("rejects a stale project revision before applying a theme", async () => {
    const session = await projectSessionRegistry.openLocal(projectPath);
    const cookie = `${PROJECT_SESSION_COOKIE}=${encodeURIComponent(session.descriptor.sessionId)}`;
    const before = await readFile(projectPath);

    const response = await POST(new Request("http://localhost/api/themes", {
      method: "POST",
      headers: {
        cookie,
        "if-match": '"stale-revision"',
        "x-project-id": session.projectId,
      },
      body: JSON.stringify({ id: "midnight" }),
    }));

    expect(response.status).toBe(412);
    expect(await readFile(projectPath)).toEqual(before);
  });

  it("requires project identity and one strong conditional ETag", async () => {
    const session = await projectSessionRegistry.openLocal(projectPath);
    const cookie = `${PROJECT_SESSION_COOKIE}=${encodeURIComponent(session.descriptor.sessionId)}`;

    expect((await GET(new Request("http://localhost/api/themes", {
      headers: { cookie },
    }))).status).toBe(428);

    expect((await POST(new Request("http://localhost/api/themes", {
      method: "POST",
      headers: { cookie, "x-project-id": session.projectId },
      body: JSON.stringify({ id: "midnight" }),
    }))).status).toBe(428);

    expect((await POST(new Request("http://localhost/api/themes", {
      method: "POST",
      headers: {
        cookie,
        "if-match": 'W/"weak-revision"',
        "x-project-id": session.projectId,
      },
      body: JSON.stringify({ id: "midnight" }),
    }))).status).toBe(400);
  });

  it("returns 409 without a session before changing themes or the project revision", async () => {
    delete process.env.PROJECT_PATH;
    process.env.INIT_CWD = dir;
    const projectBefore = await readFile(projectPath);
    const themePath = join(dir, "themes/midnight.json");
    const themeBefore = await readFile(themePath);

    expect((await GET(new Request("http://localhost/api/themes"))).status).toBe(409);
    expect((await POST(new Request("http://localhost/api/themes", {
      method: "POST",
      body: JSON.stringify({ id: "midnight" }),
    }))).status).toBe(409);

    expect(projectRevision(await readFile(projectPath))).toBe(projectRevision(projectBefore));
    expect(await readFile(themePath)).toEqual(themeBefore);
  });
});
