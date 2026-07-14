// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleTemplateGet, handleTemplatePost } from "./handler.js";

let dir: string;
let projectPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "template-route-"));
  projectPath = join(dir, "app-store-screenshots.json");
  await mkdir(join(dir, "templates"));
  await writeFile(projectPath, JSON.stringify({
    meta: { name: "Templates", schemaVersion: 1 }, mode: "isolated",
    platforms: ["apple"], locales: ["en"], fonts: [],
    screens: [{ id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en", artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#000000" }, elements: [] }],
  }));
  await writeFile(join(dir, "templates/accent-card.json"), JSON.stringify({
    id: "accent-card", name: "Accent card", platform: "apple", device: "iphone",
    artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#111111" },
    elements: [{ id: "accent", type: "shape", x: 20, y: 20, width: 620, height: 20, rotation: 0, opacity: 1, locked: false, visible: true, kind: "rect", fill: "#38BDF8", radius: 10 }],
  }));
  process.env.PROJECT_PATH = projectPath;
});

afterEach(async () => {
  delete process.env.PROJECT_PATH;
  await rm(dir, { recursive: true, force: true });
});

describe("/api/templates", () => {
  it("lists definitions and creates a durable screen", async () => {
    const listed = await handleTemplateGet();
    expect((await listed.json()).templates).toMatchObject([{ id: "accent-card" }]);
    const response = await handleTemplatePost(new Request("http://localhost/api/templates", {
      method: "POST", body: JSON.stringify({ id: "accent-card", locale: "uk" }),
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).screenId).toBe("accent-card");
    const saved = JSON.parse(await readFile(projectPath, "utf8"));
    expect(saved.screens.at(-1)).toMatchObject({ id: "accent-card", locale: "uk" });
  });

  it("returns explicit errors for invalid input", async () => {
    const response = await handleTemplatePost(new Request("http://localhost/api/templates", {
      method: "POST", body: JSON.stringify({ id: "../bad", locale: "en" }),
    }));
    expect(response.status).toBe(400);
  });
});
