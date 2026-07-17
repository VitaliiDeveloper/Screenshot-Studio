// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectRevision } from "@screenshot-studio/core/storage";
import { handleThemeGet, handleThemePost } from "./handler.js";

let dir: string;
let projectPath: string;

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
  process.env.PROJECT_PATH = projectPath;
});

afterEach(async () => {
  delete process.env.PROJECT_PATH;
  await rm(dir, { recursive: true, force: true });
});

describe("/api/themes", () => {
  it("lists definitions and applies one durably", async () => {
    const listed = await handleThemeGet();
    expect((await listed.json()).themes).toMatchObject([{ id: "midnight", name: "Midnight" }]);

    const response = await handleThemePost(new Request("http://localhost/api/themes", {
      method: "POST",
      body: JSON.stringify({ id: "midnight" }),
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).layouts[0].screens[0].elements[0].fill).toBe("#38BDF8");
    const persisted = await readFile(projectPath);
    expect(JSON.parse(persisted.toString("utf8")).layouts[0].screens[0].elements[0].fill).toBe("#38BDF8");
    expect(response.headers.get("etag")).toBe(`"${projectRevision(persisted)}"`);
  });

  it("returns explicit errors for missing and invalid ids", async () => {
    const nullBody = await handleThemePost(new Request("http://localhost/api/themes", {
      method: "POST", body: "null",
    }));
    expect(nullBody.status).toBe(400);
    expect((await nullBody.json()).error).toMatch(/JSON object/i);

    const missing = await handleThemePost(new Request("http://localhost/api/themes", {
      method: "POST", body: JSON.stringify({ id: "missing" }),
    }));
    expect(missing.status).toBe(404);
    const invalid = await handleThemePost(new Request("http://localhost/api/themes", {
      method: "POST", body: JSON.stringify({ id: "../bad" }),
    }));
    expect(invalid.status).toBe(400);
  });
});
