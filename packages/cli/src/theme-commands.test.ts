// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listBuiltInDesignPacks } from "@screenshot-studio/core/themes";
import { resolveThemeAction, runThemeCommand } from "./theme-commands.js";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "theme-command-"));
  const projectPath = join(dir, "app-store-screenshots.json");
  const project = {
    meta: { name: "Themes", schemaVersion: 1 }, preferredExportLayoutId: "default",
    fonts: [{ family: "Inter", source: "uploaded", path: "assets/fonts/inter-700.ttf", weight: 700 }],
    layouts: [{ id: "default", name: "Default", mode: "isolated", screens: [{ id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en", artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#111111" }, elements: [{ id: "title", type: "text", role: "heading", x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, locked: false, visible: true, content: "Title", fontFamily: "Old", size: 24, weight: 400, lineHeight: 1.2, letterSpacing: 0, align: "left", color: "#FFFFFF" }] }] }],
  };
  const theme = { id: "midnight", name: "Midnight", colors: { heading: "#F8FAFC", body: "#CBD5E1", accent: "#38BDF8", surface: "#0F172A" }, fonts: { heading: { family: "Inter", weight: 700 } } };
  await mkdir(join(dir, "themes"));
  await writeFile(projectPath, JSON.stringify(project));
  await writeFile(join(dir, "themes/midnight.json"), JSON.stringify(theme));
  return { dir, projectPath };
}

describe("resolveThemeAction", () => {
  it("accepts list and set with a slug id", () => {
    expect(resolveThemeAction(["list"])).toEqual({ kind: "list" });
    expect(resolveThemeAction(["set", "midnight"])).toEqual({ kind: "set", id: "midnight", source: "project" });
    expect(resolveThemeAction(["set", "neutral-default"], { "built-in": "true" }))
      .toEqual({ kind: "set", id: "neutral-default", source: "built-in" });
  });

  it("rejects traversal and incomplete commands", () => {
    expect(() => resolveThemeAction(["set", "../bad"])).toThrow(/lowercase slug/);
    expect(() => resolveThemeAction(["set"])).toThrow(/theme <list\|set/);
  });
});

describe("runThemeCommand", () => {
  it("loads, applies, and persists a theme", async () => {
    const { projectPath } = await fixture();
    await expect(runThemeCommand(projectPath, ["set", "midnight"]))
      .resolves.toBe('Applied theme "Midnight" (midnight)');
    const saved = JSON.parse(await readFile(projectPath, "utf8"));
    expect(saved.layouts[0].screens[0].elements[0]).toMatchObject({ role: "heading", color: "#F8FAFC", fontFamily: "Inter", weight: 700 });
  });

  it("lists built-in design packs and project themes", async () => {
    const { projectPath } = await fixture();
    await expect(runThemeCommand(projectPath, ["list"]))
      .resolves.toBe([
        "built-in neutral-default Neutral default",
        "built-in clean Clean",
        "built-in aurora Aurora",
        "built-in midnight Midnight",
        "built-in poster Poster",
        "built-in sunrise Sunrise",
        "project midnight Midnight",
      ].join("\n"));
  });

  it("applies a built-in design pack only when --built-in is explicit", async () => {
    const { projectPath } = await fixture();
    await expect(runThemeCommand(projectPath, ["set", "neutral-default"])).rejects.toThrow(/not found/);
    await expect(runThemeCommand(projectPath, ["set", "neutral-default"], { "built-in": "true" }))
      .resolves.toBe('Applied built-in design pack "Neutral default" (neutral-default)');
    const saved = JSON.parse(await readFile(projectPath, "utf8"));
    expect(saved.layouts[0].screens[0].elements[0]).toMatchObject({ role: "heading", color: "#0F172A", fontFamily: "Screenshot Studio Sans" });
  });

  it("does not write when a theme is invalid", async () => {
    const { dir, projectPath } = await fixture();
    const before = await readFile(projectPath, "utf8");
    await writeFile(join(dir, "themes/midnight.json"), "{}");
    await expect(runThemeCommand(projectPath, ["set", "midnight"])).rejects.toThrow(/Invalid theme/);
    expect(await readFile(projectPath, "utf8")).toBe(before);
  });

  it("lists and applies a project design pack only with --pack, reporting broken packs", async () => {
    const { dir, projectPath } = await fixture();
    const clean = listBuiltInDesignPacks().find((pack) => pack.id === "clean")!;
    await mkdir(join(dir, "packs/house"), { recursive: true });
    await writeFile(join(dir, "packs/house/design-pack.json"), JSON.stringify({ ...clean, id: "house", name: "House", palette: { ...clean.palette, heading: "#123456" } }));
    await mkdir(join(dir, "packs/broken"));

    const lines = (await runThemeCommand(projectPath, ["list"])).split("\n");
    expect(lines).toContain("project-pack house House");
    expect(lines.at(-1)).toBe("invalid-pack packs/broken: expected exactly one of screen-pack.json or design-pack.json");
    await expect(runThemeCommand(projectPath, ["set", "house"])).rejects.toThrow(/not found/);
    expect(() => resolveThemeAction(["set", "house"], { pack: "true", "built-in": "true" })).toThrow(/either --built-in or --pack/);
    await expect(runThemeCommand(projectPath, ["set", "house"], { pack: "true" }))
      .resolves.toBe('Applied project design pack "House" (house)');
    const saved = JSON.parse(await readFile(projectPath, "utf8"));
    expect(saved.layouts[0].screens[0].elements[0]).toMatchObject({ color: "#123456", fontFamily: clean.typography.heading.family });
    await expect(runThemeCommand(projectPath, ["set", "broken"], { pack: "true" })).rejects.toThrow("packs/broken: expected exactly one");
  });
});
