// SPDX-License-Identifier: Apache-2.0
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { resolveElementAction, runElementCommand } from "./element-commands.js";

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

async function fixture(layouts = [{ id: "default", name: "Default", mode: "isolated", screens: [screen("hero", "en"), screen("hero-uk", "uk")] }]) {
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
      .toThrow(/--all-sizes applies only to element text/);
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
    type Elements = ReturnType<typeof screen>["elements"];
    const variant = (id: string, storeTargetId: string, mutate: (elements: Elements) => Elements) => {
      const root = screen("hero", "en");
      return {
        ...root, id, variantOf: "hero", storeTargetId, artboard: { width: 1320, height: 2868 },
        elements: mutate(root.elements.map((element) => ({ ...element, id: `${id}-${element.id}` }))),
      };
    };
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
