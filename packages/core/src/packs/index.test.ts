// SPDX-License-Identifier: Apache-2.0
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseProject, type Project } from "@screenshot-studio/core/model";
import { findBuiltInDesignPack } from "@screenshot-studio/core/themes";
import {
  listProjectPacks,
  loadProjectPack,
  packAssetUrls,
  projectPackAssetPath,
  readProjectPackAsset,
  templatePackFromLayout,
  withPackAssetUrls,
} from "./index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function projectRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "project-packs-")));
  roots.push(root);
  return root;
}

const screenPack = (id: string, assetUrl = "assets/hero.png") => ({
  id, name: "House", description: "House style.", platform: "apple", device: "iphone", style: id,
  screens: [{
    id: "hero", name: "Hero", platform: "apple", device: "iphone",
    artboard: { width: 1206, height: 2622 },
    background: { type: "image", assetUrl, fit: "cover" },
    elements: [{ id: "logo", type: "image", x: 0, y: 0, width: 10, height: 10, rotation: 0, opacity: 1, locked: false, visible: true, assetUrl: "assets/logo.png", fit: "contain" }],
  }],
});

async function writePack(root: string, id: string, manifest: string, body: unknown, assets: string[] = []) {
  const folder = join(root, "packs", id);
  await mkdir(join(folder, "assets"), { recursive: true });
  await writeFile(join(folder, manifest), typeof body === "string" ? body : JSON.stringify(body));
  for (const asset of assets) await writeFile(join(folder, asset), `bytes of ${asset}`);
}

describe("project pack discovery", () => {
  it("lists a missing packs folder as empty", async () => {
    expect(await listProjectPacks(await projectRoot())).toEqual({ packs: [], errors: [] });
  });

  it("returns the valid pack next to a per-file error for the broken one", async () => {
    const root = await projectRoot();
    await writePack(root, "house", "screen-pack.json", screenPack("house"), ["assets/hero.png", "assets/logo.png"]);
    await writePack(root, "broken", "screen-pack.json", "{ not json");
    await writeFile(join(root, "packs", "README.md"), "Team packs");

    const listing = await listProjectPacks(root);
    expect(listing.packs.map(({ kind, pack, manifest }) => [kind, pack.id, manifest]))
      .toEqual([["screen", "house", "packs/house/screen-pack.json"]]);
    expect(listing.errors).toEqual([{ file: "packs/broken/screen-pack.json", message: expect.stringMatching(/not valid JSON/) }]);
  });

  it("validates both manifest kinds against the built-in pack schemas", async () => {
    const root = await projectRoot();
    const design = { ...findBuiltInDesignPack("clean")!, id: "house-style", name: "House style" };
    await writePack(root, "house-style", "design-pack.json", design);
    await writePack(root, "extra", "design-pack.json", { ...design, id: "extra", fonts: {} });
    await writePack(root, "mismatch", "screen-pack.json", screenPack("other"));
    await writePack(root, "clean", "design-pack.json", { ...design, id: "clean" });
    await writePack(root, "both", "design-pack.json", { ...design, id: "both" });
    await writeFile(join(root, "packs", "both", "screen-pack.json"), "{}");

    const listing = await listProjectPacks(root);
    expect(listing.packs.map(({ kind, pack }) => `${kind}:${pack.id}`)).toEqual(["design:house-style"]);
    expect(Object.fromEntries(listing.errors.map(({ file, message }) => [file, message]))).toEqual({
      "packs/both": expect.stringMatching(/exactly one of screen-pack.json or design-pack.json/),
      "packs/clean/design-pack.json": expect.stringMatching(/already a built-in pack/),
      "packs/extra/design-pack.json": expect.stringMatching(/invalid design pack: .*fonts/),
      "packs/mismatch/screen-pack.json": expect.stringMatching(/id "other" must match its folder name "mismatch"/),
    });
  });

  it("rejects asset paths that leave the pack folder, naming the manifest", async () => {
    const root = await projectRoot();
    await writeFile(join(root, "outside.png"), "outside");
    await writePack(root, "dotdot", "screen-pack.json", screenPack("dotdot", "../outside.png"), ["assets/logo.png"]);
    await writePack(root, "absolute", "screen-pack.json", screenPack("absolute", "/etc/passwd"), ["assets/logo.png"]);
    await writePack(root, "linked", "screen-pack.json", screenPack("linked"), ["assets/logo.png"]);
    await symlink(join(root, "outside.png"), join(root, "packs/linked/assets/hero.png"));
    await writePack(root, "linked-dir", "screen-pack.json", screenPack("linked-dir"), []);
    await rm(join(root, "packs/linked-dir/assets"), { recursive: true });
    await mkdir(join(root, "elsewhere"));
    await writeFile(join(root, "elsewhere/hero.png"), "x");
    await writeFile(join(root, "elsewhere/logo.png"), "x");
    await symlink(join(root, "elsewhere"), join(root, "packs/linked-dir/assets"));
    await writePack(root, "missing", "screen-pack.json", screenPack("missing"), ["assets/logo.png"]);

    const { packs, errors } = await listProjectPacks(root);
    expect(packs).toEqual([]);
    expect(Object.fromEntries(errors.map(({ file, message }) => [file, message]))).toEqual({
      "packs/absolute/screen-pack.json": expect.stringMatching(/screens\.0\.background\.assetUrl: expected a portable project-relative path/),
      "packs/dotdot/screen-pack.json": expect.stringMatching(/screens\.0\.background\.assetUrl: expected a portable project-relative path/),
      "packs/linked/screen-pack.json": "assets/hero.png must not be or pass through a symbolic link",
      "packs/linked-dir/screen-pack.json": "assets/hero.png must not be or pass through a symbolic link",
      "packs/missing/screen-pack.json": "missing file assets/hero.png",
    });
  });

  it("refuses a linked pack folder or packs directory", async () => {
    const root = await projectRoot();
    const other = await projectRoot();
    await writePack(other, "house", "screen-pack.json", screenPack("house"), ["assets/hero.png", "assets/logo.png"]);
    await mkdir(join(root, "packs"));
    await symlink(join(other, "packs/house"), join(root, "packs/house"));
    expect((await listProjectPacks(root)).errors).toEqual([{ file: "packs/house", message: "must not be a symbolic link" }]);

    await rm(join(root, "packs"), { recursive: true });
    await symlink(join(other, "packs"), join(root, "packs"));
    expect(await listProjectPacks(root)).toEqual({ packs: [], errors: [{ file: "packs", message: "must not be a symbolic link" }] });
    await expect(loadProjectPack(root, "house")).rejects.toThrow("packs: must not be a symbolic link");
  });

  it("loads one pack by id, reads its assets, and reports a missing pack as not found", async () => {
    const root = await projectRoot();
    await writePack(root, "house", "screen-pack.json", screenPack("house"), ["assets/hero.png", "assets/logo.png"]);
    const loaded = await loadProjectPack(root, "house");
    expect(loaded.kind).toBe("screen");
    expect((await readProjectPackAsset(root, "house", "assets/hero.png")).toString()).toBe("bytes of assets/hero.png");
    await expect(loadProjectPack(root, "nope")).rejects.toMatchObject({ notFound: true, file: "packs/nope" });
    await expect(loadProjectPack(root, "../x")).rejects.toThrow(/lowercase slug/);
  });
});

describe("pack asset rewriting", () => {
  it("collects every raster URL once and rewrites them to digest-named project assets", async () => {
    const root = await projectRoot();
    await writePack(root, "house", "screen-pack.json", screenPack("house"), ["assets/hero.png", "assets/logo.png"]);
    const { pack } = await loadProjectPack(root, "house") as { pack: Parameters<typeof packAssetUrls>[0] };
    expect(packAssetUrls(pack)).toEqual(["assets/hero.png", "assets/logo.png"]);
    const target = projectPackAssetPath("house", "assets/hero.png", new TextEncoder().encode("a"));
    expect(target).toMatch(/^assets\/packs\/house\/[0-9a-f]{12}-hero\.png$/);
    expect(projectPackAssetPath("house", "assets/hero.png", new TextEncoder().encode("b"))).not.toBe(target);
    const rewritten = withPackAssetUrls(pack, new Map([["assets/hero.png", target]]));
    expect(packAssetUrls(rewritten)).toEqual([target, "assets/logo.png"]);
  });
});

describe("templatePackFromLayout", () => {
  const screen = (id: string, fields: Record<string, unknown> = {}) => ({
    id, name: id, platform: "apple", device: "iphone", locale: "en",
    artboard: { width: 1206, height: 2622 }, background: { type: "solid", color: "#000000" }, elements: [], ...fields,
  });
  const project = (mode: "isolated" | "connected", screens: unknown[]): Project => parseProject({
    meta: { name: "P", schemaVersion: 1 }, fonts: [], preferredExportLayoutId: "default",
    layouts: [{ id: "default", name: "Launch", mode, screens }],
  });

  it("exports root screens of one locale and family with literal artboards", () => {
    const source = project("isolated", [
      screen("Hero Shot", { background: { type: "image", assetUrl: "assets/bg.png", fit: "cover" } }),
      screen("de-hero", { locale: "de" }),
      screen("pad", { device: "ipad", artboard: { width: 2064, height: 2752 } }),
    ]);
    const { pack, assets, skipped } = templatePackFromLayout(source, "default", "launch");
    expect(pack).toMatchObject({ id: "launch", name: "Launch", platform: "apple", device: "iphone", style: "launch" });
    expect(pack.panorama).toBeUndefined();
    expect(pack.screens.map((template) => [template.id, template.targetId, template.artboard])).toEqual([["hero-shot", undefined, { width: 1206, height: 2622 }]]);
    expect(assets).toEqual(["assets/bg.png"]);
    expect(skipped).toEqual(["pad"]);
    expect(templatePackFromLayout(source, "default", "launch", "de").pack.screens.map((template) => template.id)).toEqual(["de-hero"]);
  });

  it("marks connected layouts as panorama and refuses right-to-left or empty selections", () => {
    expect(templatePackFromLayout(project("connected", [screen("a")]), "default", "strip").pack.panorama).toBe(true);
    expect(() => templatePackFromLayout(project("isolated", [screen("a", { locale: "ar", direction: "rtl" })]), "default", "x"))
      .toThrow(/right-to-left/);
    expect(() => templatePackFromLayout(project("isolated", [screen("a")]), "default", "x", "fr")).toThrow(/no root screens in locale "fr"/);
    expect(() => templatePackFromLayout(project("isolated", [screen("a")]), "default", "Bad Id")).toThrow(/lowercase slug/);
  });
});
