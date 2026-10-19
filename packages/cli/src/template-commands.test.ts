// SPDX-License-Identifier: Apache-2.0
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_STORE_SPECS } from "@screenshot-studio/core/export";
import { resolveTemplateAction, runTemplateCommand } from "./template-commands.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const layout = (id: string, name: string) => ({
  id, name, mode: "isolated",
  screens: [{ id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en", artboard: { width: 1206, height: 2622 }, background: { type: "solid", color: "#000000" }, elements: [] }],
});

async function fixture(layouts = [layout("default", "Default")]) {
  const dir = await mkdtemp(join(tmpdir(), "template-command-"));
  roots.push(dir);
  const projectPath = join(dir, "app-store-screenshots.json");
  const specsPath = join(dir, "store-specs.json");
  await mkdir(join(dir, "templates"));
  await writeFile(specsPath, JSON.stringify(DEFAULT_STORE_SPECS));
  await writeFile(projectPath, JSON.stringify({
    meta: { name: "Templates", schemaVersion: 1 }, fonts: [], preferredExportLayoutId: layouts[0]!.id, layouts,
  }));
  await writeFile(join(dir, "templates/accent-card.json"), JSON.stringify({
    id: "accent-card", name: "Accent card", platform: "apple", device: "iphone",
    artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#111111" },
    elements: [{ id: "accent", type: "shape", role: "accent", x: 20, y: 20, width: 620, height: 20, rotation: 0, opacity: 1, locked: false, visible: true, kind: "rect", fill: "#38BDF8", radius: 10 }],
  }));
  return { projectPath, specsPath };
}

async function screenIds(projectPath: string, layoutIndex = 0): Promise<string[]> {
  const saved = JSON.parse(await readFile(projectPath, "utf8"));
  return saved.layouts[layoutIndex].screens.map((screen: { id: string }) => screen.id);
}

describe("resolveTemplateAction", () => {
  it("parses list and add", () => {
    expect(resolveTemplateAction(["list"], {})).toEqual({ kind: "list" });
    expect(resolveTemplateAction(["add", "iphone-starter"], { locale: "uk", "built-in": "true" }))
      .toEqual({ kind: "add", id: "iphone-starter", locale: "uk", builtIn: true });
  });

  it("rejects a missing locale, traversal, and unknown subcommands", () => {
    expect(() => resolveTemplateAction(["add", "iphone-starter"], {})).toThrow(/--locale/);
    expect(() => resolveTemplateAction(["add", "../bad"], { locale: "en" })).toThrow(/lowercase slug/);
    expect(() => resolveTemplateAction(["apply"], {})).toThrow(/Usage: screenshots template/);
  });
});

describe("runTemplateCommand", () => {
  it("lists built-in and project templates with their source", async () => {
    const { projectPath, specsPath } = await fixture();
    const lines = (await runTemplateCommand(projectPath, specsPath, ["list"], {})).split("\n");
    expect(lines).toContainEqual(expect.stringMatching(/^built-in iphone-starter apple\/iphone \S+ iPhone$/));
    expect(lines.at(-1)).toBe("project accent-card apple/iphone - Accent card");
  });

  it("adds the same built-in template repeatedly as distinct screens", async () => {
    const { projectPath, specsPath } = await fixture();
    for (let index = 0; index < 3; index++) {
      await runTemplateCommand(projectPath, specsPath, ["add", "iphone-starter"], { locale: "en", "built-in": "true" });
    }
    const ids = await screenIds(projectPath);
    expect(ids.slice(0, 2)).toEqual(["hero", "iphone-starter"]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id.startsWith("iphone-starter")).length).toBeGreaterThanOrEqual(3);
  });

  it("adds a project template and never falls back between sources", async () => {
    const { projectPath, specsPath } = await fixture();
    await expect(runTemplateCommand(projectPath, specsPath, ["add", "accent-card"], { locale: "uk" }))
      .resolves.toBe("Added screen accent-card (apple/iphone uk) from project template accent-card");
    const before = await readFile(projectPath, "utf8");
    await expect(runTemplateCommand(projectPath, specsPath, ["add", "iphone-starter"], { locale: "en" }))
      .rejects.toThrow(/not found/);
    await expect(runTemplateCommand(projectPath, specsPath, ["add", "accent-card"], { locale: "en", "built-in": "true" }))
      .rejects.toThrow(/Built-in template "accent-card" not found/);
    expect(await readFile(projectPath, "utf8")).toBe(before);
  });

  it("requires --layout in a multi-layout project", async () => {
    const { projectPath, specsPath } = await fixture([layout("default", "Default"), layout("campaign", "Campaign")]);
    await expect(runTemplateCommand(projectPath, specsPath, ["add", "accent-card"], { locale: "en" }))
      .rejects.toThrow(/--layout/);
    await runTemplateCommand(projectPath, specsPath, ["add", "accent-card"], { locale: "en", layout: "campaign" });
    expect(await screenIds(projectPath, 0)).toEqual(["hero"]);
    expect(await screenIds(projectPath, 1)).toEqual(["hero", "accent-card"]);
  });
});
