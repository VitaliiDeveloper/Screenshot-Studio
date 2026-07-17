// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectRevision } from "@screenshot-studio/core/storage";
import {
  PROJECT_SESSION_COOKIE,
  projectSessionRegistry,
} from "../../../lib/project-session.server.js";
import { handleTemplateGet, handleTemplatePost } from "./handler.js";
import { GET, POST } from "./route.js";

let dir: string;
let projectPath: string;
const originalInitCwd = process.env.INIT_CWD;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "template-route-"));
  projectPath = join(dir, "app-store-screenshots.json");
  await mkdir(join(dir, "templates"));
  await writeFile(projectPath, JSON.stringify({
    meta: { name: "Templates", schemaVersion: 1 }, fonts: [],
    preferredExportLayoutId: "primary",
    layouts: [{ id: "primary", name: "Primary", mode: "isolated", screens: [{ id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en", artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#000000" }, elements: [] }] }],
  }));
  await writeFile(join(dir, "templates/accent-card.json"), JSON.stringify({
    id: "accent-card", name: "Accent card", platform: "apple", device: "iphone",
    artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#111111" },
    elements: [{ id: "accent", type: "shape", x: 20, y: 20, width: 620, height: 20, rotation: 0, opacity: 1, locked: false, visible: true, kind: "rect", fill: "#38BDF8", radius: 10 }],
  }));
});

afterEach(async () => {
  delete process.env.PROJECT_PATH;
  if (originalInitCwd === undefined) delete process.env.INIT_CWD;
  else process.env.INIT_CWD = originalInitCwd;
  await rm(dir, { recursive: true, force: true });
});

describe("/api/templates", () => {
  it("lists definitions and creates a durable screen", async () => {
    const listed = await handleTemplateGet(projectPath);
    expect((await listed.json()).templates).toMatchObject([{ id: "accent-card" }]);
    const response = await handleTemplatePost(projectPath, new Request("http://localhost/api/templates", {
      method: "POST", body: JSON.stringify({ id: "accent-card", locale: "uk" }),
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).screenId).toBe("accent-card");
    const persisted = await readFile(projectPath);
    const saved = JSON.parse(persisted.toString("utf8"));
    expect(saved.layouts[0].screens.at(-1)).toMatchObject({ id: "accent-card", locale: "uk" });
    expect(response.headers.get("etag")).toBe(`"${projectRevision(persisted)}"`);
  });

  it("returns explicit errors for invalid input", async () => {
    const nullBody = await handleTemplatePost(projectPath, new Request("http://localhost/api/templates", {
      method: "POST", body: "null",
    }));
    expect(nullBody.status).toBe(400);
    expect((await nullBody.json()).error).toMatch(/JSON object/i);

    const response = await handleTemplatePost(projectPath, new Request("http://localhost/api/templates", {
      method: "POST", body: JSON.stringify({ id: "../bad", locale: "en" }),
    }));
    expect(response.status).toBe(400);
  });

  it("routes reads and mutations through the cookie-selected project session", async () => {
    const session = await projectSessionRegistry.openLocal(projectPath);
    process.env.PROJECT_PATH = join(dir, "configured-missing.json");
    const cookie = `${PROJECT_SESSION_COOKIE}=${encodeURIComponent(session.descriptor.sessionId)}`;

    const listed = await GET(new Request("http://localhost/api/templates", { headers: { cookie } }));
    expect((await listed.json()).templates).toMatchObject([{ id: "accent-card" }]);

    const created = await POST(new Request("http://localhost/api/templates", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ id: "accent-card", locale: "uk" }),
    }));
    expect(created.status).toBe(200);
    expect((await created.json()).screenId).toBe("accent-card");
  });

  it("returns 409 without a session before changing templates or the project revision", async () => {
    delete process.env.PROJECT_PATH;
    process.env.INIT_CWD = dir;
    const projectBefore = await readFile(projectPath);
    const templatePath = join(dir, "templates/accent-card.json");
    const templateBefore = await readFile(templatePath);

    expect((await GET(new Request("http://localhost/api/templates"))).status).toBe(409);
    expect((await POST(new Request("http://localhost/api/templates", {
      method: "POST",
      body: JSON.stringify({ id: "accent-card", locale: "uk" }),
    }))).status).toBe(409);

    expect(projectRevision(await readFile(projectPath))).toBe(projectRevision(projectBefore));
    expect(await readFile(templatePath)).toEqual(templateBefore);
  });
});
