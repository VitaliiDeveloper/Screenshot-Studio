// SPDX-License-Identifier: Apache-2.0
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { COMMAND_FLAG_SPECS, parseCommandFlags } from "./command-flags.js";
import { resolveElementAction, runElementCommand } from "./element-commands.js";
import { updateProjectFile } from "./project-io.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const base = { rotation: 0, opacity: 1, locked: false, visible: true };
const text = (id: string, content: string, extra = {}) => ({
  id, type: "text", ...base, x: 0, y: 0, width: 100, height: 40, content,
  fontFamily: "Screenshot Studio Sans", size: 24, weight: 400, lineHeight: 1.2, letterSpacing: 0,
  align: "left", color: "#FFFFFF", ...extra,
});

function screen(id: string, locale: string) {
  return {
    id, name: id, platform: "apple", device: "iphone", locale, direction: "ltr",
    artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#111111" },
    elements: [
      text("title", "Track every run", { role: "heading" }),
      { id: "badge", type: "group", ...base, x: 10, y: 10, width: 200, height: 60, children: [text("badge-label", "4.9 ★")] },
      { id: "shot", type: "screenshot", ...base, x: 0, y: 100, width: 300, height: 600, assetUrl: "assets/a.png", fit: "cover", cornerRadius: 0 },
      { id: "mockup", type: "device-frame", ...base, x: 300, y: 100, width: 300, height: 600, deviceType: "iphone", fit: "cover" },
    ],
  };
}

async function fixture(layouts: Array<{ id: string } & Record<string, unknown>> = [{ id: "default", name: "Default", mode: "isolated", screens: [screen("hero", "en"), screen("hero-uk", "uk")] }]) {
  const dir = await mkdtemp(join(tmpdir(), "element-command-"));
  roots.push(dir);
  const projectPath = join(dir, "app-store-screenshots.json");
  await mkdir(join(dir, "assets"));
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#FFFFFF" } }).png().toBuffer();
  await writeFile(join(dir, "assets/a.png"), png);
  await writeFile(join(dir, "assets/b.png"), png);
  await writeFile(join(dir, "assets/notes.png"), "not an image");
  await writeFile(projectPath, JSON.stringify({
    meta: { name: "Elements", schemaVersion: 1 }, fonts: [], preferredExportLayoutId: layouts[0]!.id, layouts,
  }));
  return { dir, projectPath };
}

type Elements = ReturnType<typeof screen>["elements"];
/** A 2x exact-size variant of hero; renaming top-level ids keeps the slot counterparts positional. */
function variant(id: string, storeTargetId: string, mutate: (elements: Elements) => Elements = (elements) => elements) {
  const root = screen("hero", "en");
  return {
    ...root, id, variantOf: "hero", storeTargetId, artboard: { width: 1320, height: 2868 },
    elements: mutate(root.elements.map((element) => ({ ...element, id: `${id}-${element.id}` }))),
  };
}

async function savedScreen(projectPath: string, id = "hero") {
  const saved = JSON.parse(await readFile(projectPath, "utf8"));
  return saved.layouts[0].screens.find((candidate: { id: string }) => candidate.id === id);
}

describe("resolveElementAction", () => {
  it("parses list filters, text content, and media paths", () => {
    expect(resolveElementAction(["list"], { locale: "uk" })).toEqual({ kind: "list", screen: undefined, locale: "uk" });
    expect(resolveElementAction(["text", "hero", "title", ""], {})).toEqual({ kind: "text", screen: "hero", element: "title", content: "", allSizes: false });
    expect(resolveElementAction(["text", "hero", "title", "Copy"], { "all-sizes": "true" }))
      .toEqual({ kind: "text", screen: "hero", element: "title", content: "Copy", allSizes: true });
    expect(resolveElementAction(["media", "hero", "shot", "assets/b.png"], {})).toEqual({ kind: "media", screen: "hero", element: "shot", path: "assets/b.png" });
  });

  it("rejects incomplete or extra arguments", () => {
    expect(() => resolveElementAction(["text", "hero", "title"], {})).toThrow(/Usage: screenshots element/);
    expect(() => resolveElementAction(["media", "hero", "shot", "a.png", "b.png"], {})).toThrow(/Usage/);
    expect(() => resolveElementAction(["rm"], {})).toThrow(/Usage/);
    expect(() => resolveElementAction(["media", "hero", "shot", "a.png"], { "all-sizes": "true" }))
      .toThrow(/--all-sizes applies only to element text and element set/);
  });

  it("parses every geometry flag for set, including negative values after the flag", () => {
    const { args, flags } = parseCommandFlags(
      ["set", "hero", "shot", "--x", "-40", "--y", "12.5", "--width", "320", "--height", "640", "--rotation", "-6", "--opacity", "0.9", "--all-sizes"],
      COMMAND_FLAG_SPECS.element,
    );
    expect(resolveElementAction(args, flags)).toEqual({
      kind: "set", screen: "hero", element: "shot", allSizes: true,
      patch: { x: -40, y: 12.5, width: 320, height: 640, rotation: -6, opacity: 0.9 },
    });
    expect(resolveElementAction(["set", "hero", "shot"], { rotation: "0" }))
      .toEqual({ kind: "set", screen: "hero", element: "shot", allSizes: false, patch: { rotation: 0 } });
  });

  it.each(["", " ", "abc", "Infinity", "-Infinity", "NaN", "1e999"])("rejects --x %j", (value) => {
    expect(() => resolveElementAction(["set", "hero", "shot"], { x: value })).toThrow("--x must be a finite number");
  });

  it("rejects set without a geometry flag, with an extra argument, and geometry flags on other subcommands", () => {
    expect(() => resolveElementAction(["set", "hero", "shot"], {})).toThrow(/needs at least one of --x/);
    expect(() => resolveElementAction(["set", "hero", "shot", "10"], { x: "1" })).toThrow(/Usage: .*set <screen> <element>/);
    expect(() => resolveElementAction(["set", "hero"], { x: "1" })).toThrow(/Usage/);
    expect(() => resolveElementAction(["text", "hero", "title", "Copy"], { rotation: "5" })).toThrow(/apply only to element set/);
    expect(() => resolveElementAction(["list"], { opacity: "0.5" })).toThrow(/apply only to element set/);
  });
});

describe("runElementCommand", () => {
  it("lists every leaf, including group children, with JSON-quoted copy", async () => {
    const { projectPath } = await fixture();
    await runElementCommand(projectPath, ["text", "hero", "title", "Line one\nLine two"], {});
    await expect(runElementCommand(projectPath, ["list"], { locale: "en" })).resolves.toBe([
      'hero en title text role=heading "Line one\\nLine two"',
      'hero en badge-label text "4.9 ★"',
      "hero en shot screenshot assets/a.png",
      "hero en mockup device-frame -",
    ].join("\n"));
    await expect(runElementCommand(projectPath, ["list"], { locale: "de" })).resolves.toBe("");
    await expect(runElementCommand(projectPath, ["list"], { screen: "missing" })).resolves.toBe("");
  });

  it("updates copy on a top-level text and a group child without touching other locales", async () => {
    const { projectPath } = await fixture();
    await runElementCommand(projectPath, ["text", "hero", "title", "Біжи далі"], {});
    await expect(runElementCommand(projectPath, ["text", "hero", "badge-label", "Top rated"], {}))
      .resolves.toBe("Updated text of hero/badge-label");
    const hero = await savedScreen(projectPath);
    expect(hero.elements[0]).toMatchObject({ id: "title", content: "Біжи далі", role: "heading" });
    expect(hero.elements[1].children[0]).toMatchObject({ id: "badge-label", content: "Top rated" });
    expect((await savedScreen(projectPath, "hero-uk")).elements[0].content).toBe("Track every run");
  });

  it("updates the counterpart layer on every matching exact size with --all-sizes", async () => {
    const { projectPath } = await fixture([{ id: "default", name: "Default", mode: "isolated", screens: [
      screen("hero", "en"),
      variant("hero-69", "6.9", (elements) => elements),
      variant("hero-65", "6.5", (elements) => elements.slice(1)),
      variant("hero-61", "6.1", (elements) => elements.map((element, index) => index === 0 ? { ...element, locked: true } : element)),
      variant("hero-55", "5.5", (elements) => elements.map((element, index) => index === 1 ? { ...element, locked: true } : element)),
      screen("hero-uk", "uk"),
    ] }]);
    await expect(runElementCommand(projectPath, ["text", "hero", "title", "Run further"], { "all-sizes": "true" }))
      .resolves.toBe([
        "Updated text of hero/title",
        "Updated text of hero-69/hero-69-title",
        "Updated text of hero-55/hero-55-title",
        "Skipped hero-65: layer structure differs from hero",
        "Skipped hero-61/hero-61-title: layer is locked",
      ].join("\n"));
    await expect(runElementCommand(projectPath, ["text", "hero-69", "badge-label", "Top rated"], { "all-sizes": "true" }))
      .resolves.toBe([
        "Updated text of hero-69/badge-label",
        "Updated text of hero/badge-label",
        "Updated text of hero-61/badge-label",
        "Skipped hero-65: layer structure differs from hero-69",
        "Skipped hero-55/badge-label: group is locked",
      ].join("\n"));
    expect((await savedScreen(projectPath, "hero-55")).elements[1].children[0].content).toBe("4.9 ★");
    expect((await savedScreen(projectPath, "hero")).elements[0].content).toBe("Run further");
    expect((await savedScreen(projectPath, "hero")).elements[1].children[0].content).toBe("Top rated");
    expect((await savedScreen(projectPath, "hero-69")).elements[0].content).toBe("Run further");
    expect((await savedScreen(projectPath, "hero-65")).elements[0].children[0].content).toBe("4.9 ★");
    expect((await savedScreen(projectPath, "hero-61")).elements[0].content).toBe("Track every run");
    expect((await savedScreen(projectPath, "hero-uk")).elements[0].content).toBe("Track every run");
  });

  it("assigns project media to screenshot and device-frame leaves", async () => {
    const { projectPath } = await fixture();
    await runElementCommand(projectPath, ["media", "hero", "shot", "assets/b.png"], {});
    await runElementCommand(projectPath, ["media", "hero", "mockup", "assets/b.png"], {});
    const hero = await savedScreen(projectPath);
    expect(hero.elements[2]).toMatchObject({ id: "shot", assetUrl: "assets/b.png", fit: "cover" });
    expect(hero.elements[3]).toMatchObject({ id: "mockup", assetUrl: "assets/b.png", deviceType: "iphone" });
  });

  it.each([
    [["text", "hero", "shot", "Copy"], /is screenshot, not text/],
    [["text", "hero", "badge", "Copy"], /is a group/],
    [["text", "hero", "missing", "Copy"], /Unknown element "missing"/],
    [["text", "nope", "title", "Copy"], /Unknown screen "nope"/],
    [["media", "hero", "title", "assets/b.png"], /media needs screenshot, image, or device-frame/],
    [["media", "hero", "shot", "assets/missing.png"], /not found in project/],
    [["media", "hero", "shot", "/etc/hosts"], /must be project-relative/],
    [["media", "hero", "shot", "../outside.png"], /must be project-relative/],
    [["media", "hero", "shot", "assets"], /not a file/],
    [["media", "hero", "shot", "assets/notes.png"], /valid PNG, JPEG, or WebP/],
  ])("rejects %j without writing", async (args, message) => {
    const { projectPath } = await fixture();
    const before = await readFile(projectPath, "utf8");
    await expect(runElementCommand(projectPath, args, {})).rejects.toThrow(message);
    expect(await readFile(projectPath, "utf8")).toBe(before);
  });

  it("rejects a media symlink that escapes the project", async () => {
    const { dir, projectPath } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "element-outside-"));
    roots.push(outside);
    await writeFile(join(outside, "secret.png"), "x");
    await symlink(join(outside, "secret.png"), join(dir, "assets/link.png"));
    await expect(runElementCommand(projectPath, ["media", "hero", "shot", "assets/link.png"], {}))
      .rejects.toThrow(/must stay inside project root/);
  });

  it("sets only the given geometry fields on a top-level leaf and a group child", async () => {
    const { projectPath } = await fixture();
    await expect(runElementCommand(projectPath, ["set", "hero", "mockup"], {
      x: "-40", y: "120", width: "420", height: "860", rotation: "-6", opacity: "0.9",
    })).resolves.toBe("Updated geometry of hero/mockup");
    await runElementCommand(projectPath, ["set", "hero", "badge-label"], { y: "8" });
    const hero = await savedScreen(projectPath);
    expect(hero.elements[3]).toMatchObject({
      id: "mockup", x: -40, y: 120, width: 420, height: 860, rotation: -6, opacity: 0.9, deviceType: "iphone",
    });
    expect(hero.elements[1]).toMatchObject({ id: "badge", x: 10, y: 10 });
    expect(hero.elements[1].children[0]).toMatchObject({ id: "badge-label", x: 0, y: 8, width: 100, rotation: 0 });
    expect(hero.elements[2]).toMatchObject({ id: "shot", x: 0, y: 100, rotation: 0, opacity: 1 });
    expect((await savedScreen(projectPath, "hero-uk")).elements[3]).toMatchObject({ x: 300, rotation: 0 });
  });

  it.each([
    [["set", "hero", "badge"], { x: "5" }, /is a group/],
    [["set", "hero", "missing"], { x: "5" }, /Unknown element "missing"/],
    [["set", "nope", "title"], { x: "5" }, /Unknown screen "nope"/],
    [["set", "hero", "shot"], { opacity: "1.5" }, /opacity/],
    [["set", "hero", "shot"], { width: "0" }, /width/],
    [["set", "hero", "shot"], { height: "-10" }, /height/],
  ])("rejects set %j %j without writing", async (args, flags, message) => {
    const { projectPath } = await fixture();
    const before = await readFile(projectPath, "utf8");
    await expect(runElementCommand(projectPath, args, flags)).rejects.toThrow(message);
    expect(await readFile(projectPath, "utf8")).toBe(before);
  });

  it("fits set geometry into every matching exact size with --all-sizes and reports skips", async () => {
    const { projectPath } = await fixture([{ id: "default", name: "Default", mode: "isolated", screens: [
      screen("hero", "en"),
      variant("hero-69", "6.9"),
      variant("hero-65", "6.5", (elements) => elements.slice(1)),
      variant("hero-61", "6.1", (elements) => elements.map((element, index) => index === 3 ? { ...element, locked: true } : element)),
      variant("hero-55", "5.5", (elements) => elements.map((element, index) => index === 1 ? { ...element, locked: true } : element)),
      screen("hero-uk", "uk"),
    ] }]);
    await expect(runElementCommand(projectPath, ["set", "hero", "mockup"], { x: "-40", width: "420", rotation: "-6", opacity: "0.9", "all-sizes": "true" }))
      .resolves.toBe([
        "Updated geometry of hero/mockup",
        "Updated geometry of hero-69/hero-69-mockup",
        "Updated geometry of hero-55/hero-55-mockup",
        "Skipped hero-65: layer structure differs from hero",
        "Skipped hero-61/hero-61-mockup: layer is locked",
      ].join("\n"));
    await expect(runElementCommand(projectPath, ["set", "hero", "badge-label"], { y: "8", "all-sizes": "true" }))
      .resolves.toBe([
        "Updated geometry of hero/badge-label",
        "Updated geometry of hero-69/badge-label",
        "Updated geometry of hero-61/badge-label",
        "Skipped hero-65: layer structure differs from hero",
        "Skipped hero-55/badge-label: group is locked",
      ].join("\n"));
    expect((await savedScreen(projectPath)).elements[3]).toMatchObject({ x: -40, y: 100, width: 420, height: 600, rotation: -6, opacity: 0.9 });
    // The 2x artboard doubles pixel fields; untouched fields keep the counterpart's own values.
    expect((await savedScreen(projectPath, "hero-69")).elements[3]).toMatchObject({ x: -80, y: 100, width: 840, height: 600, rotation: -6, opacity: 0.9 });
    expect((await savedScreen(projectPath, "hero-69")).elements[1].children[0]).toMatchObject({ y: 16 });
    expect((await savedScreen(projectPath, "hero-61")).elements[3]).toMatchObject({ x: 300, rotation: 0 });
    expect((await savedScreen(projectPath, "hero-55")).elements[1].children[0]).toMatchObject({ y: 0 });
    expect((await savedScreen(projectPath, "hero-uk")).elements[3]).toMatchObject({ x: 300, rotation: 0 });
  });

  it("skips a size whose fitted layer would leave the schema range", async () => {
    const ring = { id: "ring", type: "shape", ...base, x: 0, y: 0, width: 100, height: 100, kind: "ellipse", fill: "#FFFFFF", radius: 0, stroke: { color: "#000000", width: 60 } };
    const { projectPath } = await fixture([{ id: "default", name: "Default", mode: "isolated", screens: [
      { ...screen("hero", "en"), elements: [ring] },
      { ...variant("hero-69", "6.9"), elements: [{ ...ring, id: "hero-69-ring" }] },
    ] }]);
    await expect(runElementCommand(projectPath, ["set", "hero", "ring"], { rotation: "8", "all-sizes": "true" }))
      .resolves.toBe([
        "Updated geometry of hero/ring",
        'Skipped hero-69/hero-69-ring: Cannot scale shape stroke width above 100 for element "ring"',
      ].join("\n"));
    expect((await savedScreen(projectPath, "hero-69")).elements[0]).toMatchObject({ rotation: 0 });
  });

  it("waits for the project lock before writing and keeps the concurrent write", async () => {
    const { projectPath } = await fixture();
    let release!: () => void;
    const mayFinish = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const didEnter = new Promise<void>((resolve) => { entered = resolve; });
    const held = updateProjectFile(projectPath, async (current) => {
      entered();
      await mayFinish;
      return { project: { ...current, meta: { ...current.meta, name: "Held writer" } }, value: undefined };
    });
    await didEnter;
    await expect(runElementCommand(projectPath, ["set", "hero", "shot"], { x: "5" }, { timeoutMs: 0 }))
      .rejects.toThrow(/Timed out.*project mutation lock/i);
    release();
    await held;
    await runElementCommand(projectPath, ["set", "hero", "shot"], { x: "5" });
    const saved = JSON.parse(await readFile(projectPath, "utf8"));
    expect(saved.meta.name).toBe("Held writer");
    expect(saved.layouts[0].screens[0].elements[2].x).toBe(5);
  });

  it("requires --layout in a multi-layout project", async () => {
    const { projectPath } = await fixture([
      { id: "default", name: "Default", mode: "isolated", screens: [screen("hero", "en")] },
      { id: "campaign", name: "Campaign", mode: "isolated", screens: [screen("hero", "en")] },
    ]);
    await expect(runElementCommand(projectPath, ["text", "hero", "title", "Copy"], {})).rejects.toThrow(/--layout/);
    await runElementCommand(projectPath, ["text", "hero", "title", "Campaign copy"], { layout: "Campaign" });
    const saved = JSON.parse(await readFile(projectPath, "utf8"));
    expect(saved.layouts[0].screens[0].elements[0].content).toBe("Track every run");
    expect(saved.layouts[1].screens[0].elements[0].content).toBe("Campaign copy");
  });
});
