// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyThemeFile, listThemes, loadTheme, ThemeValidationError } from "./theme-service.js";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "theme-service-"));
  const projectPath = join(dir, "app-store-screenshots.json");
  const project = {
    meta: { name: "Themes", schemaVersion: 5 }, mode: "isolated", platforms: ["apple"], locales: ["en"], fonts: [],
    screens: [{ id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en", artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#111111" }, elements: [{ id: "accent", type: "shape", role: "accent", x: 0, y: 0, width: 100, height: 10, rotation: 0, opacity: 1, locked: false, visible: true, kind: "rect", fill: "#FFFFFF", radius: 0 }] }],
  };
  const theme = { id: "midnight", name: "Midnight", colors: { heading: "#F8FAFC", body: "#CBD5E1", accent: "#38BDF8", surface: "#0F172A" }, fonts: {} };
  await mkdir(join(dir, "themes"));
  await writeFile(projectPath, JSON.stringify(project));
  await writeFile(join(dir, "themes/midnight.json"), JSON.stringify(theme));
  return { dir, projectPath, theme };
}

describe("theme-service", () => {
  it("lists definitions in stable id order", async () => {
    const { dir, projectPath, theme } = await fixture();
    await writeFile(join(dir, "themes/amber.json"), JSON.stringify({ ...theme, id: "amber", name: "Amber" }));
    expect((await listThemes(projectPath)).map((item) => item.id)).toEqual(["amber", "midnight"]);
  });

  it("rejects mismatched filenames and ids", async () => {
    const { dir, projectPath, theme } = await fixture();
    await writeFile(join(dir, "themes/wrong.json"), JSON.stringify({ ...theme, id: "other" }));
    await expect(listThemes(projectPath)).rejects.toBeInstanceOf(ThemeValidationError);
  });

  it("loads and applies a theme through the shared service", async () => {
    const { projectPath } = await fixture();
    expect((await loadTheme(projectPath, "midnight")).name).toBe("Midnight");
    await applyThemeFile(projectPath, "midnight");
    const saved = JSON.parse(await readFile(projectPath, "utf8"));
    expect(saved.screens[0].elements[0].fill).toBe("#38BDF8");
  });
});
