// SPDX-License-Identifier: Apache-2.0
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
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

async function fixture(layouts: { id: string }[] = [layout("default", "Default")]) {
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
      .toEqual({ kind: "add", id: "iphone-starter", locale: "uk", source: "built-in" });
    expect(resolveTemplateAction(["add", "neutral-iphone-basics"], { locale: "uk", pack: "true" }))
      .toEqual({ kind: "add", id: "neutral-iphone-basics", locale: "uk", source: "pack" });
    expect(resolveTemplateAction(["add", "accent-card"], { locale: "uk" }))
      .toEqual({ kind: "add", id: "accent-card", locale: "uk", source: "project" });
  });

  it("rejects a missing locale, traversal, and unknown subcommands", () => {
    expect(() => resolveTemplateAction(["add", "iphone-starter"], {})).toThrow(/--locale/);
    expect(() => resolveTemplateAction(["add", "../bad"], { locale: "en" })).toThrow(/lowercase slug/);
    expect(() => resolveTemplateAction(["apply"], {})).toThrow(/Usage: screenshots template/);
    expect(() => resolveTemplateAction(["export-pack", "default"], {})).toThrow(/--out packs\/<name>/);
    expect(() => resolveTemplateAction(["add", "neutral-iphone-basics"], { locale: "en", pack: "true", "built-in": "true" }))
      .toThrow(/either --built-in or --pack/);
  });
});

describe("runTemplateCommand", () => {
  it("lists built-in and project templates with their source", async () => {
    const { projectPath, specsPath } = await fixture();
    const lines = (await runTemplateCommand(projectPath, specsPath, ["list"], {})).split("\n");
    expect(lines).toContainEqual(expect.stringMatching(/^built-in iphone-starter apple\/iphone \S+ iPhone$/));
    expect(lines).toContain("built-in-pack neutral-iphone-basics apple/iphone neutral-default 2 Neutral basics · iPhone");
    expect(lines.at(-1)).toBe("project accent-card apple/iphone - Accent card");
  });

  it("adds every screen of a built-in pack and reports their ids", async () => {
    const { projectPath, specsPath } = await fixture();
    const output = await runTemplateCommand(projectPath, specsPath, ["add", "neutral-iphone-basics"], { locale: "uk", pack: "true" });
    expect(output).toBe("Added 2 screens (apple/iphone uk) from built-in pack neutral-iphone-basics: neutral-iphone-hero, neutral-iphone-feature");
    expect(await screenIds(projectPath)).toEqual(["hero", "neutral-iphone-hero", "neutral-iphone-feature"]);
  });

  it("targets the requested layout for a pack and rejects an unknown pack id without writing", async () => {
    const { projectPath, specsPath } = await fixture([layout("default", "Default"), layout("campaign", "Campaign")]);
    await expect(runTemplateCommand(projectPath, specsPath, ["add", "neutral-iphone-basics"], { locale: "en", pack: "true" }))
      .rejects.toThrow(/--layout/);
    await runTemplateCommand(projectPath, specsPath, ["add", "neutral-iphone-basics"], { locale: "en", pack: "true", layout: "campaign" });
    expect(await screenIds(projectPath, 0)).toEqual(["hero"]);
    expect(await screenIds(projectPath, 1)).toEqual(["hero", "neutral-iphone-hero", "neutral-iphone-feature"]);
    const before = await readFile(projectPath, "utf8");
    await expect(runTemplateCommand(projectPath, specsPath, ["add", "no-such-pack"], { locale: "en", pack: "true", layout: "campaign" }))
      .rejects.toThrow(/Template pack "no-such-pack" not found: no built-in pack and no packs\/no-such-pack/);
    await expect(runTemplateCommand(projectPath, specsPath, ["add", "iphone-starter"], { locale: "en", pack: "true", layout: "campaign" }))
      .rejects.toThrow(/Template pack "iphone-starter" not found/);
    await expect(runTemplateCommand(projectPath, specsPath, ["add", "neutral-iphone-basics"], { locale: "en", "built-in": "true", layout: "campaign" }))
      .rejects.toThrow(/Built-in template "neutral-iphone-basics" not found/);
    expect(await readFile(projectPath, "utf8")).toBe(before);
  });

  it("adds one screen of a built-in pack by its screen id", async () => {
    const { projectPath, specsPath } = await fixture();
    await expect(runTemplateCommand(projectPath, specsPath, ["add", "clean-iphone-hero"], { locale: "en", "built-in": "true" }))
      .resolves.toBe("Added screen clean-iphone-hero (apple/iphone en) from built-in template clean-iphone-hero");
    expect(await screenIds(projectPath)).toEqual(["hero", "clean-iphone-hero"]);
    await expect(runTemplateCommand(projectPath, specsPath, ["add", "clean-panorama-iphone-hero"], { locale: "en", "built-in": "true" }))
      .rejects.toThrow(/Built-in template "clean-panorama-iphone-hero" not found/);
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

  describe("project packs", () => {
    const withImage = (id: string) => ({
      ...layout(id, "Launch"),
      screens: [{
        ...layout(id, "Launch").screens[0]!,
        background: { type: "image", assetUrl: "assets/bg.png", fit: "cover" },
        elements: [{ id: "accent", type: "shape", role: "accent", x: 20, y: 20, width: 620, height: 20, rotation: 0, opacity: 1, locked: false, visible: true, kind: "rect", fill: "#38BDF8", radius: 10 }],
      }],
    });

    async function exported() {
      const { projectPath, specsPath } = await fixture([withImage("default")]);
      const dir = join(projectPath, "..");
      await mkdir(join(dir, "assets"));
      await writeFile(join(dir, "assets/bg.png"), "background bytes");
      const output = await runTemplateCommand(projectPath, specsPath, ["export-pack", "default"], { out: join(dir, "packs/launch"), json: "true" });
      return { projectPath, specsPath, dir, report: JSON.parse(output) };
    }

    it("exports a layout as a manifest plus copied assets that lists as a project pack", async () => {
      const { projectPath, specsPath, dir, report } = await exported();
      expect(report).toEqual({ dir: "packs/launch", pack: "launch", screens: ["hero"], assets: ["assets/bg.png"], skipped: [] });
      expect(await readFile(join(dir, "packs/launch/assets/bg.png"), "utf8")).toBe("background bytes");
      const manifest = JSON.parse(await readFile(join(dir, "packs/launch/screen-pack.json"), "utf8"));
      expect(manifest).toMatchObject({ id: "launch", platform: "apple", device: "iphone", screens: [{ id: "hero", background: { assetUrl: "assets/bg.png" } }] });

      const lines = (await runTemplateCommand(projectPath, specsPath, ["list"], {})).split("\n");
      expect(lines).toContain("project-pack launch apple/iphone launch 1 Launch");
      const listed = JSON.parse(await runTemplateCommand(projectPath, specsPath, ["list"], { json: "true" }));
      expect(listed.packs).toContainEqual(expect.objectContaining({ source: "project", id: "launch", screenCount: 1 }));
      expect(listed.errors).toEqual([]);
    });

    it("applies a copied pack in another project, publishing its assets as project assets", async () => {
      const { dir } = await exported();
      const target = await fixture();
      const targetDir = join(target.projectPath, "..");
      await cp(join(dir, "packs"), join(targetDir, "packs"), { recursive: true });

      const output = await runTemplateCommand(target.projectPath, target.specsPath, ["add", "launch"], { locale: "de", pack: "true" });
      expect(output).toMatch(/^Added 1 screen \(apple\/iphone de\) from project pack launch: /);
      const saved = JSON.parse(await readFile(target.projectPath, "utf8"));
      const added = saved.layouts[0].screens[1];
      expect(added.background.assetUrl).toMatch(/^assets\/packs\/launch\/[0-9a-f]{12}-bg\.png$/);
      expect(await readFile(join(targetDir, added.background.assetUrl), "utf8")).toBe("background bytes");
      // Re-applying converges on the same published bytes instead of conflicting.
      await runTemplateCommand(target.projectPath, target.specsPath, ["add", "launch"], { locale: "de", pack: "true" });
      expect(await readdir(join(targetDir, "assets/packs/launch"))).toHaveLength(1);
    });

    it("lists a broken pack as an error line and refuses to apply it without writing", async () => {
      const { projectPath, specsPath, dir } = await exported();
      await writeFile(join(dir, "outside.png"), "secret");
      await rm(join(dir, "packs/launch/assets/bg.png"));
      await symlink(join(dir, "outside.png"), join(dir, "packs/launch/assets/bg.png"));
      const lines = (await runTemplateCommand(projectPath, specsPath, ["list"], {})).split("\n");
      expect(lines.at(-1)).toBe("invalid-pack packs/launch/screen-pack.json: assets/bg.png must not be or pass through a symbolic link");
      const before = await readFile(projectPath, "utf8");
      await expect(runTemplateCommand(projectPath, specsPath, ["add", "launch"], { locale: "en", pack: "true" }))
        .rejects.toThrow("packs/launch/screen-pack.json: assets/bg.png must not be or pass through a symbolic link");
      expect(await readFile(projectPath, "utf8")).toBe(before);

      await rm(join(dir, "packs/launch/assets/bg.png"));
      await expect(runTemplateCommand(projectPath, specsPath, ["add", "launch"], { locale: "en", pack: "true" }))
        .rejects.toMatchObject({ name: "TemplateValidationError", message: "packs/launch/screen-pack.json: missing file assets/bg.png" });
      await rm(join(dir, "assets/bg.png"));
      await expect(runTemplateCommand(projectPath, specsPath, ["export-pack", "default"], { out: join(dir, "packs/other") }))
        .rejects.toMatchObject({ name: "TemplateValidationError", message: "assets/bg.png: missing file assets/bg.png" });
      expect(await readFile(projectPath, "utf8")).toBe(before);
    });

    it("refuses to overwrite without --force and refuses --out outside packs/<name> in the project", async () => {
      const { projectPath, specsPath, dir } = await exported();
      await expect(runTemplateCommand(projectPath, specsPath, ["export-pack", "default"], { out: join(dir, "packs/launch") }))
        .rejects.toThrow("packs/launch already exists; pass --force to replace it");
      await writeFile(join(dir, "assets/bg.png"), "new background");
      await expect(runTemplateCommand(projectPath, specsPath, ["export-pack", "default"], { out: join(dir, "packs/launch"), force: "true" }))
        .resolves.toBe("Exported 1 screen (apple/iphone) and 1 asset to packs/launch");
      expect(await readFile(join(dir, "packs/launch/assets/bg.png"), "utf8")).toBe("new background");

      const outside = await mkdtemp(join(tmpdir(), "template-outside-"));
      roots.push(outside);
      for (const out of [join(outside, "packs/launch"), join(dir, "launch"), join(dir, "packs/launch/nested"), join(dir, "packs/Bad Name")]) {
        await expect(runTemplateCommand(projectPath, specsPath, ["export-pack", "default"], { out }))
          .rejects.toThrow(/--out must be packs\/<lowercase-slug> inside the project folder/);
      }
      expect(await readdir(outside)).toEqual([]);

      await expect(runTemplateCommand(projectPath, specsPath, ["export-pack", "default"], { out: join(dir, "packs/neutral-iphone-basics") }))
        .rejects.toThrow(/already a built-in pack id/);
      await mkdir(join(dir, "packs/style"));
      await writeFile(join(dir, "packs/style/design-pack.json"), "{}");
      await expect(runTemplateCommand(projectPath, specsPath, ["export-pack", "default"], { out: join(dir, "packs/style"), force: "true" }))
        .rejects.toThrow("packs/style holds a design pack; --force replaces only a screen pack");
      expect((await readdir(join(dir, "packs"))).sort()).toEqual(["launch", "style"]);
      expect(await readdir(join(dir, "packs/style"))).toEqual(["design-pack.json"]);
    });
  });
});
