// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTemplateScreen, listTemplates, TemplateValidationError } from "./template-service.js";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "template-service-"));
  const projectPath = join(dir, "app-store-screenshots.json");
  const template = {
    id: "accent-card", name: "Accent card", platform: "apple", device: "iphone",
    artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#111111" },
    elements: [{ id: "accent", type: "shape", role: "accent", x: 20, y: 20, width: 620, height: 20, rotation: 0, opacity: 1, locked: false, visible: true, kind: "rect", fill: "#38BDF8", radius: 10 }],
  };
  await mkdir(join(dir, "templates"));
  await writeFile(projectPath, JSON.stringify({
    meta: { name: "Templates", schemaVersion: 8 }, mode: "isolated", platforms: ["apple"], locales: ["en"], fonts: [],
    screens: [{ id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en", artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#000000" }, elements: [] }],
  }));
  await writeFile(join(dir, "templates/accent-card.json"), JSON.stringify(template));
  return { dir, projectPath, template };
}

describe("template-service", () => {
  it("lists definitions in stable id order", async () => {
    const { dir, projectPath, template } = await fixture();
    await writeFile(join(dir, "templates/blank.json"), JSON.stringify({ ...template, id: "blank", name: "Blank" }));
    expect((await listTemplates(projectPath)).map((item) => item.id)).toEqual(["accent-card", "blank"]);
  });

  it("rejects mismatched filenames and ids", async () => {
    const { dir, projectPath, template } = await fixture();
    await writeFile(join(dir, "templates/wrong.json"), JSON.stringify({ ...template, id: "other" }));
    await expect(listTemplates(projectPath)).rejects.toBeInstanceOf(TemplateValidationError);
  });

  it("creates and persists a screen", async () => {
    const { projectPath } = await fixture();
    const result = await createTemplateScreen(projectPath, "accent-card", "uk");
    expect(result.screen).toMatchObject({ id: "accent-card", locale: "uk" });
    const saved = JSON.parse(await readFile(projectPath, "utf8"));
    expect(saved.screens).toHaveLength(2);
    expect(saved.locales).toEqual(["en", "uk"]);
  });
});
