// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveThemeAction, runThemeCommand } from "./theme-commands.js";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "theme-command-"));
  const projectPath = join(dir, "app-store-screenshots.json");
  const project = {
    meta: { name: "Themes", schemaVersion: 1 }, mode: "isolated", platforms: ["apple"], locales: ["en"],
    fonts: [{ family: "Inter", source: "uploaded", path: "assets/fonts/inter-700.ttf", weight: 700 }],
    screens: [{ id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en", artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#111111" }, elements: [{ id: "title", type: "text", role: "heading", x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, locked: false, visible: true, content: "Title", fontFamily: "Old", size: 24, weight: 400, lineHeight: 1.2, letterSpacing: 0, align: "left", color: "#FFFFFF" }] }],
  };
  const theme = { id: "midnight", name: "Midnight", colors: { heading: "#F8FAFC", body: "#CBD5E1", accent: "#38BDF8", surface: "#0F172A" }, fonts: { heading: { family: "Inter", weight: 700 } } };
  await mkdir(join(dir, "themes"));
  await writeFile(projectPath, JSON.stringify(project));
  await writeFile(join(dir, "themes/midnight.json"), JSON.stringify(theme));
  return { dir, projectPath };
}

describe("resolveThemeAction", () => {
  it("accepts set with a slug id", () => {
    expect(resolveThemeAction(["set", "midnight"])).toEqual({ kind: "set", id: "midnight" });
  });

  it("rejects traversal and incomplete commands", () => {
    expect(() => resolveThemeAction(["set", "../bad"])).toThrow(/lowercase slug/);
    expect(() => resolveThemeAction(["list"])).toThrow(/theme set/);
  });
});

describe("runThemeCommand", () => {
  it("loads, applies, and persists a theme", async () => {
    const { projectPath } = await fixture();
    await expect(runThemeCommand(projectPath, ["set", "midnight"]))
      .resolves.toBe('Applied theme "Midnight" (midnight)');
    const saved = JSON.parse(await readFile(projectPath, "utf8"));
    expect(saved.screens[0].elements[0]).toMatchObject({ role: "heading", color: "#F8FAFC", fontFamily: "Inter", weight: 700 });
  });

  it("does not write when a theme is invalid", async () => {
    const { dir, projectPath } = await fixture();
    const before = await readFile(projectPath, "utf8");
    await writeFile(join(dir, "themes/midnight.json"), "{}");
    await expect(runThemeCommand(projectPath, ["set", "midnight"])).rejects.toThrow(/Invalid theme/);
    expect(await readFile(projectPath, "utf8")).toBe(before);
  });
});
