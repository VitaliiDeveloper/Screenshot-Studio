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
import { handleTemplatePost } from "@web/app/api/templates/handler.js";
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
    const body = await listed.json();
    expect(body).toMatchObject({ themes: [{ id: "midnight", name: "Midnight" }] });
    expect(body.builtIns[0]).toMatchObject({ id: "neutral-default", name: "Neutral default", background: { type: "linear-gradient" } });
    expect(body.builtIns).toHaveLength(6);
    expect(body.templatePacks[0]).toMatchObject({ id: "neutral-iphone-basics", style: "neutral-default", screenCount: 2 });
    expect(body.templatePacks).toContainEqual(expect.objectContaining({ id: "midnight-android-phone", style: "midnight", platform: "android", device: "phone", screenCount: 6 }));

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
    expect(body.layouts[0].screens[0].elements[0]).toMatchObject({ fill: "#1D4ED8", radius: 0 });
    expect(body.layouts[0].screens[0].background).toMatchObject({ type: "linear-gradient", from: "#F8FAFC" });
    const persisted = JSON.parse((await readFile(projectPath)).toString("utf8"));
    expect(JSON.stringify(persisted)).not.toContain("neutral-default");
    expect(await readdir(dir)).toEqual(beforeEntries);
  });

  it("lists project packs with their errors and applies both kinds through the shared services", async () => {
    const clean = (await (await handleThemeGet(projectPath)).json()).builtIns.find((pack: { id: string }) => pack.id === "clean");
    await mkdir(join(dir, "packs/house"), { recursive: true });
    await writeFile(join(dir, "packs/house/design-pack.json"), JSON.stringify({ ...clean, id: "house", name: "House" }));
    await mkdir(join(dir, "packs/hero/assets"), { recursive: true });
    const png = await readFile(new URL("../../../../../fixtures/regressions/screenshot-parity/assets/shot.png", import.meta.url));
    await writeFile(join(dir, "packs/hero/assets/bg.png"), png);
    await writeFile(join(dir, "packs/hero/screen-pack.json"), JSON.stringify({
      id: "hero", name: "Hero", description: "One screen.", platform: "apple", device: "iphone", style: "hero",
      screens: [{ id: "hero-one", name: "One", platform: "apple", device: "iphone", artboard: { width: 660, height: 1434 }, background: { type: "image", assetUrl: "assets/bg.png", fit: "cover" }, elements: [] }],
    }));
    await mkdir(join(dir, "packs/broken"));

    const body = await (await handleThemeGet(projectPath)).json();
    expect(body.projectDesignPacks).toEqual([expect.objectContaining({ id: "house", name: "House" })]);
    expect(body.projectTemplatePacks).toEqual([{ id: "hero", name: "Hero", description: "One screen.", platform: "apple", device: "iphone", style: "hero", panorama: false, screenCount: 1 }]);
    expect(body.packErrors).toEqual([{ file: "packs/broken", message: "expected exactly one of screen-pack.json or design-pack.json" }]);

    const design = await handleThemePost(projectPath, new Request("http://localhost/api/themes", {
      method: "POST", body: JSON.stringify({ id: "house", source: "project-pack" }),
    }));
    expect(design.status).toBe(200);
    expect((await design.json()).layouts[0].screens[0].elements[0].fill).toBe(clean.palette.accent);

    const screens = await handleTemplatePost(projectPath, new Request("http://localhost/api/templates", {
      method: "POST", body: JSON.stringify({ id: "hero", source: "project-pack", locale: "en" }),
    }));
    expect(screens.status).toBe(200);
    const added = (await screens.json()).project.layouts[0].screens[1];
    expect(added.background.assetUrl).toMatch(/^assets\/packs\/hero\/[0-9a-f]{12}-bg\.png$/);
    expect(await readFile(join(dir, added.background.assetUrl))).toEqual(png);

    const broken = await handleThemePost(projectPath, new Request("http://localhost/api/themes", {
      method: "POST", body: JSON.stringify({ id: "broken", source: "project-pack" }),
    }));
    expect(broken.status).toBe(400);
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
