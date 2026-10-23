// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildBundleEntries,
  findStoreTarget,
  parseStoreSpecs,
  validateBundleArtboards,
} from "@screenshot-studio/core/export";
import {
  ensureStoreTargetVariant,
  elementLeaves,
  isBuiltInFontIdentity,
  setScreenDirection,
  parseProject,
  setLocaleDirection,
  setOutputFamilyScreenSetMode,
  type Project,
} from "@screenshot-studio/core/model";
import { findBuiltInDesignPack } from "@screenshot-studio/core/themes";
import {
  createScreenFromTemplate,
  createScreensFromTemplatePack,
  listBuiltInTemplatePackMetadata,
  listBuiltInTemplatePacks,
  TemplatePack,
  listBuiltInProjectStarterMetadata,
  listBuiltInTemplates,
  ScreenTemplate,
  type ScreenTemplate as Template,
} from "./index.js";

const storeSpecs = parseStoreSpecs(JSON.parse(readFileSync(join(process.cwd(), "store-specs.json"), "utf8")));
const reorderedIpadSpecs = parseStoreSpecs({
  ...storeSpecs,
  platforms: {
    ...storeSpecs.platforms,
    apple: {
      ...storeSpecs.platforms.apple,
      families: {
        ...storeSpecs.platforms.apple.families,
        ipad: {
          ...storeSpecs.platforms.apple.families.ipad,
          targets: [...storeSpecs.platforms.apple.families.ipad.targets].reverse(),
        },
      },
    },
  },
});

function project(): Project {
  return {
    meta: { name: "Templates", schemaVersion: 1 },
    fonts: [{ family: "Inter", source: "uploaded", path: "assets/fonts/inter-700.ttf", weight: 700 }],
    preferredExportLayoutId: "default",
    layouts: [{
      id: "default", name: "Default", mode: "connected",
      screens: [{ id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en", direction: "ltr", artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#111111" }, elements: [] }],
    }],
  };
}

const template: Template = {
  id: "feature-card", name: "Feature card", description: "Headline and accent",
  platform: "android", device: "phone", artboard: { width: 1080, height: 1920 },
  background: { type: "solid", color: "#0F172A" },
  elements: [
    { id: "title", type: "text", role: "heading", x: 80, y: 120, width: 920, height: 180, rotation: 0, opacity: 1, locked: false, visible: true, content: "Feature", fontFamily: "Inter", size: 72, weight: 700, lineHeight: 1.2, letterSpacing: 0, align: "center", color: "#FFFFFF" },
    { id: "accent", type: "shape", role: "accent", x: 80, y: 340, width: 920, height: 40, rotation: 0, opacity: 1, locked: false, visible: true, kind: "rect", fill: "#38BDF8", radius: 20 },
  ],
};

function synchronizedAndroidProject(direction: "ltr" | "rtl" = "ltr"): Project {
  const initial = createScreenFromTemplate(project(), "default", template, "en").project;
  const withTarget = ensureStoreTargetVariant(initial, "default", "feature-card", {
    id: "phone-landscape",
    width: 1920,
    height: 1080,
  }).project;
  const synchronized = setOutputFamilyScreenSetMode(
    withTarget,
    "default",
    "feature-card",
    "synchronized",
  );
  return direction === "rtl"
    ? setLocaleDirection(synchronized, "default", "en", "rtl")
    : synchronized;
}

describe("ScreenTemplate", () => {
  it("strictly validates platform/device and fields", () => {
    expect(ScreenTemplate.parse(template).id).toBe("feature-card");
    expect(() => ScreenTemplate.parse({ ...template, device: "ipad" })).toThrow();
    expect(() => ScreenTemplate.parse({ ...template, unexpected: true })).toThrow();
  });
});

describe("built-in templates", () => {
  it("exposes the exact device restriction for project-creation starters", () => {
    const starters = listBuiltInProjectStarterMetadata();
    expect(starters).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "iphone-starter", platform: "apple", device: "iphone" }),
      expect.objectContaining({ id: "ipad-portrait-starter", platform: "apple", device: "ipad" }),
      expect.objectContaining({ id: "web-mobile-starter", platform: "web", device: "mobile" }),
    ]));
    const starterIds = starters.map(({ id }) => id);
    for (const resourceOnlyId of [
      "macos-starter", "tvos-starter", "visionos-starter", "wear-os-starter",
    ]) {
      expect(starterIds).not.toContain(resourceOnlyId);
    }
  });

  it("covers every requested starter and keeps promotion art frame-free", () => {
    const templates = listBuiltInTemplates(storeSpecs, { family: "Inter", weight: 700 });
    expect(templates.map(({ id }) => id)).toEqual([
      "iphone-starter", "ipad-portrait-starter", "ipad-landscape-starter",
      "android-phone-starter", "android-tablet-portrait-starter",
      "android-tablet-landscape-starter", "web-desktop-starter", "web-mobile-starter",
      "play-feature-graphic", "web-share-cover", "macos-starter", "tvos-starter",
      "visionos-starter", "wear-os-starter",
    ]);
    const marketingTemplates = templates.filter(({ id }) => id !== "wear-os-starter");
    expect(marketingTemplates.every((entry) => (
      entry.elements.some((element) => element.type === "text")
    ))).toBe(true);
    expect(templates.flatMap(({ elements }) => elements)
      .filter((element) => element.type === "device-frame")
      .every((frame) => frame.assetUrl === undefined)).toBe(true);
    const feature = templates.find(({ id }) => id === "play-feature-graphic")!;
    expect(feature).toMatchObject({
      platform: "android", device: "phone", targetId: "play-feature-graphic",
      artboard: { width: 1024, height: 500 },
    });
    expect(feature.elements.some((element) => element.type === "device-frame")).toBe(false);
    expect(feature.elements.map((element) => element.name)).toEqual(expect.arrayContaining(["Safe zone guide", "Focal zone guide"]));
    expect(marketingTemplates.every(({ elements }) => (
      elements.some((element) => (
        element.id === "headline" && element.name === undefined && "role" in element && element.role === "heading"
      ))
      && elements.some((element) => (
        element.name === "Accent panel" && "role" in element && element.role === "accent"
      ))
    ))).toBe(true);
    expect(feature.elements
      .filter((element) => element.name === "Safe zone guide" || element.name === "Focal zone guide")
      .every((element) => !("role" in element) || element.role === undefined)).toBe(true);
  });

  it.each([
    ["macos-starter", "apple", "macos", "2880x1800", 2880, 1800],
    ["tvos-starter", "apple", "tvos", "4k", 3840, 2160],
    ["visionos-starter", "apple", "visionos", "vision-pro", 3840, 2160],
    ["wear-os-starter", "android", "wear", "wear-square", 384, 384],
  ] as const)(
    "declares %s for its exact output family and configured target",
    (id, platform, device, targetId, width, height) => {
      const starter = listBuiltInTemplates(storeSpecs).find((candidate) => candidate.id === id)!;

      expect(starter).toMatchObject({
        platform,
        device,
        targetId,
        artboard: { width, height },
      });
      expect(findStoreTarget(storeSpecs, platform, device, targetId)).toMatchObject({
        id: targetId,
        width,
        height,
      });
    },
  );

  it("keeps the Wear OS Store starter to one frameless, artboard-filling app screenshot", () => {
    const starter = listBuiltInTemplates(storeSpecs)
      .find(({ id }) => id === "wear-os-starter")!;

    expect(starter.elements).toEqual([
      expect.objectContaining({
        type: "screenshot",
        name: "Replace with app screenshot",
        x: 0,
        y: 0,
        width: starter.artboard.width,
        height: starter.artboard.height,
      }),
    ]);
    expect(starter.elements.some((element) => (
      element.type === "device-frame"
      || element.type === "image"
      || element.type === "shape"
      || element.type === "text"
      || element.type === "icon"
      || element.type === "group"
    ))).toBe(false);
  });

  it("materializes editable copy in a project with no custom fonts", () => {
    const emptyFontProject = project();
    emptyFontProject.fonts = [];
    const builtIn = listBuiltInTemplates(storeSpecs).find(({ id }) => id === "web-desktop-starter")!;

    const result = createScreenFromTemplate(emptyFontProject, "default", builtIn, "en", storeSpecs);

    expect(result.screen.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "text",
        fontFamily: "Screenshot Studio Sans",
        weight: 400,
      }),
    ]));
  });

  it.each([
    ["ipad-landscape-starter", "13-landscape", 2752, 2064],
    ["android-tablet-landscape-starter", "tablet-landscape", 2560, 1440],
    ["play-feature-graphic", "play-feature-graphic", 1024, 500],
  ] as const)("materializes %s as an exportable exact-target variant", (id, targetId, width, height) => {
    const builtIn = listBuiltInTemplates(storeSpecs).find((candidate) => candidate.id === id)!;
    const result = createScreenFromTemplate(project(), "default", builtIn, "en", storeSpecs);

    expect(result.screen).toMatchObject({
      variantOf: expect.any(String), storeTargetId: targetId, artboard: { width, height },
    });
    const entries = buildBundleEntries(result.project, "default", storeSpecs, {
      platform: result.screen.platform,
      device: result.screen.device,
    });
    expect(entries.find((entry) => entry.screen.id === result.screen.id)?.target.id).toBe(targetId);
    expect(() => validateBundleArtboards(entries)).not.toThrow();
  });

  it("uses the catalog lead when materializing a non-lead template from reordered targets", () => {
    const builtIn = listBuiltInTemplates(reorderedIpadSpecs)
      .find(({ id }) => id === "ipad-landscape-starter")!;

    const result = createScreenFromTemplate(
      project(),
      "default",
      builtIn,
      "en",
      reorderedIpadSpecs,
    );
    const root = result.project.layouts[0]!.screens.find((screen) => (
      screen.id === result.screen.variantOf
    ));

    expect(reorderedIpadSpecs.platforms.apple.families.ipad.targets[0]!.id).toBe("11-landscape");
    expect(root).toMatchObject({
      platform: "apple",
      device: "ipad",
      artboard: { width: 2064, height: 2752 },
    });
    expect(result.screen).toMatchObject({
      variantOf: root!.id,
      storeTargetId: "13-landscape",
      artboard: { width: 2752, height: 2064 },
    });
  });

  it("can materialize an exact target without a primary pair when creation owns that contract", () => {
    const builtIn = listBuiltInTemplates(storeSpecs).find(({ id }) => id === "play-feature-graphic")!;
    const result = createScreenFromTemplate(project(), "default", builtIn, "en", storeSpecs, {
      exactTargetMode: "standalone",
    });

    expect(result.screen).toMatchObject({
      platform: "android",
      device: "phone",
      storeTargetId: "play-feature-graphic",
      artboard: { width: 1024, height: 500 },
    });
    expect(result.screen.variantOf).toBeUndefined();
  });
});

describe("createScreenFromTemplate", () => {
  it("appends a fresh-id screen and injects its locale into one layout", () => {
    const result = createScreenFromTemplate(project(), "default", template, "uk");
    expect(result.screen).toMatchObject({ platform: "android", device: "phone", locale: "uk", name: "Feature card" });
    expect(result.screen.id).toBe("feature-card");
    expect(result.screen.elements.map((element) => element.id)).not.toEqual(["title", "accent"]);
    expect(new Set(result.screen.elements.map((element) => element.id)).size).toBe(2);
    expect(result.project.layouts[0]!.mode).toBe("connected");
    expect(result.project.layouts[0]!.screens.map((screen) => screen.platform)).toEqual(["apple", "android"]);
    expect(result.project.layouts[0]!.screens.map((screen) => screen.locale)).toEqual(["en", "uk"]);
  });

  it("preserves structured backgrounds instead of flattening them", () => {
    const gradient: Template = {
      ...template,
      background: { type: "linear-gradient", from: "#112233", to: "#AABBCC", angle: 35 },
    };
    expect(createScreenFromTemplate(project(), "default", gradient, "en").screen.background).toEqual(
      gradient.background,
    );
  });

  it("bakes LTR template geometry for an existing RTL locale", () => {
    const rtlProject = project();
    rtlProject.layouts[0]!.screens[0]!.direction = "rtl";
    const title = template.elements[0]!;
    if (title.type !== "text") throw new Error("Expected template title text");
    const rtlTemplate: Template = {
      ...template,
      elements: [{
        ...title,
        id: "rtl-title",
        x: 100,
        width: 300,
        align: "left",
      }],
    };

    const result = createScreenFromTemplate(rtlProject, "default", rtlTemplate, "en");

    expect(result.screen.direction).toBe("rtl");
    expect(result.screen.elements[0]).toMatchObject({ x: 680, align: "right" });
    expect(rtlTemplate.elements[0]).toMatchObject({ x: 100, align: "left" });
  });

  it("uses a unique screen id on repeated creation", () => {
    const first = createScreenFromTemplate(project(), "default", template, "en").project;
    expect(createScreenFromTemplate(first, "default", template, "en").screen.id).toBe("feature-card-2");
  });

  it("returns and localizes the new root when a synchronized family also creates exact-size variants", () => {
    const title = template.elements[0]!;
    if (title.type !== "text") throw new Error("Expected template title text");
    const rtlTemplate: Template = {
      ...template,
      elements: [{ ...title, id: "rtl-title", x: 100, width: 300, align: "left" }],
    };

    const result = createScreenFromTemplate(
      synchronizedAndroidProject("rtl"),
      "default",
      rtlTemplate,
      "en",
    );
    const mirrored = result.project.layouts[0]!.screens.find((screen) => (
      screen.variantOf === result.screen.id && screen.storeTargetId === "phone-landscape"
    ));

    expect(result.screen).toMatchObject({
      id: "feature-card-2",
      direction: "rtl",
    });
    expect(result.screen.variantOf).toBeUndefined();
    expect(result.screen.storeTargetId).toBeUndefined();
    expect(result.screen.elements[0]).toMatchObject({ x: 680, align: "right" });
    expect(mirrored).toMatchObject({ direction: "rtl", variantOf: result.screen.id });
    expect(mirrored!.elements[0]).toMatchObject({ align: "right" });
  });

  it("returns the new non-lead target variant for a synchronized family", () => {
    const landscape: Template = {
      ...template,
      id: "feature-landscape",
      targetId: "phone-landscape",
      artboard: { width: 1920, height: 1080 },
    };

    const result = createScreenFromTemplate(
      synchronizedAndroidProject(),
      "default",
      landscape,
      "en",
      storeSpecs,
    );
    const root = result.project.layouts[0]!.screens.find((screen) => screen.id === result.screen.variantOf);

    expect(root).toMatchObject({
      id: "feature-landscape",
      artboard: { width: 1080, height: 1920 },
    });
    expect(root!.variantOf).toBeUndefined();
    expect(root!.storeTargetId).toBeUndefined();
    expect(result.screen).toMatchObject({
      variantOf: root!.id,
      storeTargetId: "phone-landscape",
      artboard: { width: 1920, height: 1080 },
    });
  });

  it("validates grouped fonts and regenerates group plus child ids", () => {
    const title = template.elements[0]!;
    if (title.type !== "text") throw new Error("expected text");
    const grouped: Template = {
      ...template,
      id: "grouped-card",
      elements: [{
        id: "group", type: "group", x: 80, y: 120, width: 920, height: 220,
        rotation: 0, opacity: 1, locked: false, visible: true,
        children: [{ ...title, id: "group-title", x: 0, y: 0 }],
      }],
    };

    const result = createScreenFromTemplate(project(), "default", grouped, "en");
    const group = result.screen.elements[0]!;
    expect(group.id).not.toBe("group");
    expect(group.type === "group" && group.children[0]!.id).not.toBe("group-title");

    const missing: Template = {
      ...grouped,
      elements: [{
        ...grouped.elements[0]!,
        children: [{ ...title, id: "missing", fontFamily: "Missing" }],
      } as never],
    };
    expect(() => createScreenFromTemplate(project(), "default", missing, "en")).toThrow(/unregistered font/);
  });

  it("preserves decorative image fields and freshens its id", () => {
    const withImage: Template = {
      ...template,
      id: "image-card",
      elements: [{
        id: "decor", type: "image", x: 80, y: 400, width: 300, height: 200,
        rotation: 0, opacity: 1, locked: false, visible: true,
        assetUrl: "assets/decor.png", fit: "contain", cornerRadius: 16,
      }],
    };
    const result = createScreenFromTemplate(project(), "default", withImage, "en");
    expect(result.screen.elements[0]).toMatchObject({
      type: "image", assetUrl: "assets/decor.png", fit: "contain", cornerRadius: 16,
    });
    expect(result.screen.elements[0]!.id).not.toBe("decor");
  });

  it("preserves icon fields and freshens its id", () => {
    const withIcon: Template = {
      ...template,
      id: "icon-card",
      elements: [{
        id: "icon", type: "icon", x: 80, y: 400, width: 160, height: 160,
        rotation: 0, opacity: 1, locked: false, visible: true,
        icon: "check", color: "#22C55E", strokeWidth: 4,
      }],
    };
    const result = createScreenFromTemplate(project(), "default", withIcon, "en");
    expect(result.screen.elements[0]).toMatchObject({
      type: "icon", icon: "check", color: "#22C55E", strokeWidth: 4,
    });
    expect(result.screen.elements[0]!.id).not.toBe("icon");
  });

  it("rejects template text with an unregistered font", () => {
    const missing = { ...template, elements: [{ ...template.elements[0]!, fontFamily: "Missing" }] } as Template;
    expect(() => createScreenFromTemplate(project(), "default", missing, "en")).toThrow(/unregistered font/);
  });
});

describe("built-in template packs", () => {
  it("resolves exact store artboards and bakes the tagged design pack", () => {
    const [pack] = listBuiltInTemplatePacks(storeSpecs);
    const style = findBuiltInDesignPack(pack!.style)!;
    const target = findStoreTarget(storeSpecs, "apple", "iphone", "6.3");
    expect(listBuiltInTemplatePackMetadata()[0]).toEqual(expect.objectContaining({
      id: pack!.id, platform: "apple", device: "iphone", style: "neutral-default", screenCount: pack!.screens.length,
    }));
    expect(pack!.screens.length).toBeGreaterThan(1);
    for (const screen of pack!.screens) {
      expect(screen.artboard).toEqual({ width: target.width, height: target.height });
      expect(screen.background).toEqual(style.background);
      for (const leaf of screen.elements.flatMap(elementLeaves)) {
        expect(leaf.x).toBeGreaterThanOrEqual(0);
        expect(leaf.y).toBeGreaterThanOrEqual(0);
        expect(leaf.x + leaf.width).toBeLessThanOrEqual(target.width);
        expect(leaf.y + leaf.height).toBeLessThanOrEqual(target.height);
        if (leaf.type === "text") expect(leaf.color).toBe(style.palette[leaf.role!]);
      }
    }
    const roles = new Set(pack!.screens.flatMap((screen) => screen.elements.flatMap(elementLeaves).map((leaf) => leaf.role)));
    expect(roles).toEqual(new Set(["heading", "body", "accent", "surface", undefined]));
  });

  it("rejects a screen outside the pack platform and device", () => {
    const [pack] = listBuiltInTemplatePacks(storeSpecs);
    expect(() => TemplatePack.parse({ ...pack, device: "ipad" })).toThrow(/apple\/ipad/);
  });

  it("appends every pack screen as an ordinary screen, with fresh ids on repeat", () => {
    const source = project();
    source.layouts[0]!.mode = "isolated";
    const [pack] = listBuiltInTemplatePacks(storeSpecs);
    const once = createScreensFromTemplatePack(source, "default", pack!, "en", storeSpecs);
    const twice = createScreensFromTemplatePack(once.project, "default", pack!, "en", storeSpecs);
    const screens = twice.project.layouts[0]!.screens;
    expect(once.screens.map((screen) => screen.name)).toEqual(pack!.screens.map((screen) => screen.name));
    expect(screens).toHaveLength(1 + pack!.screens.length * 2);
    expect(new Set(screens.map((screen) => screen.id)).size).toBe(screens.length);
    expect(parseProject(twice.project)).toEqual(twice.project);
  });
});

type Box = { x: number; y: number; width: number; height: number };
const intersects = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const STYLES = ["clean", "aurora", "midnight", "poster", "sunrise"];
const styledPacks = () => listBuiltInTemplatePacks(storeSpecs).filter((pack) => STYLES.includes(pack.style));

describe("styled template packs", () => {
  it("ships every style for iPhone and Android phone with the full six-screen narrative", () => {
    const packs = styledPacks();
    expect(packs.map((pack) => pack.id)).toEqual(STYLES.flatMap((style) => [`${style}-iphone`, `${style}-android-phone`]));
    for (const pack of packs) {
      expect(findBuiltInDesignPack(pack.style), pack.id).toBeDefined();
      expect(pack.screens.map((screen) => screen.name)).toEqual(["Hero", "Feature 1", "Feature 2", "Feature 3", "Social proof", "Call to action"]);
    }
    expect(listBuiltInTemplatePackMetadata().filter((pack) => STYLES.includes(pack.style)).map((pack) => [pack.platform, pack.device, pack.screenCount]))
      .toEqual(STYLES.flatMap(() => [["apple", "iphone", 6], ["android", "phone", 6]]));
  });

  it.each(["ltr", "rtl"] as const)("keeps %s geometry exact, readable, and clear of the device", (direction) => {
    for (const pack of styledPacks()) {
      const style = findBuiltInDesignPack(pack.style)!;
      const target = findStoreTarget(storeSpecs, pack.platform as "apple" | "android", pack.device, pack.screens[0]!.targetId!);
      for (const template of pack.screens) {
        const label = `${template.id} ${direction}`;
        const screen = setScreenDirection({
          id: template.id, name: template.name, platform: template.platform, device: template.device, locale: "en",
          direction: "ltr", artboard: template.artboard, background: template.background, elements: template.elements,
        } as Project["layouts"][number]["screens"][number], direction);
        const { width, height } = screen.artboard;
        expect(screen.artboard, label).toEqual({ width: target.width, height: target.height });
        expect(screen.background, label).toEqual(style.background);
        const leaves = screen.elements.flatMap(elementLeaves);
        const device = leaves.find((leaf) => leaf.type === "device-frame")!;
        expect(device.x, label).toBeGreaterThanOrEqual(0);
        expect(device.y, label).toBeGreaterThanOrEqual(0);
        expect(device.x + device.width, label).toBeLessThanOrEqual(width);
        expect(device.y + device.height - height, label).toBeLessThanOrEqual(device.height * 0.15);
        expect(device.width / width, label).toBeGreaterThan(0.35);

        for (const text of leaves.filter((leaf) => leaf.type === "text")) {
          const where = `${label} ${text.id}`;
          expect(isBuiltInFontIdentity({ family: text.fontFamily, weight: text.weight }), where).toBe(true);
          expect(text.color, where).toBe(style.palette[text.role!]);
          expect(text.x, where).toBeGreaterThanOrEqual(0);
          expect(text.x + text.width, where).toBeLessThanOrEqual(width);
          expect(text.y + text.height, where).toBeLessThanOrEqual(height);
          expect(intersects(text, device), where).toBe(false);
          const minimumLines = text.role === "heading" || text.role === "body" ? 3 : 1;
          expect(text.height, where).toBeGreaterThanOrEqual(Math.floor(text.size * text.lineHeight * minimumLines));
          // The themes test proves these role pairs readable for every styled pack.
          for (const shape of leaves.filter((leaf) => leaf.type === "shape" && intersects(leaf, text))) {
            if (shape.type !== "shape") continue;
            const pair = `${text.role} on ${shape.role}`;
            expect(shape.opacity === 1 && !shape.gradient && shape.fill === style.palette[shape.role!], `${where} over ${shape.id}`).toBe(true);
            expect(["heading on surface", "body on surface", "accent on surface", "surface on accent"], `${where} over ${shape.id}`).toContain(pair);
          }
        }
        if (direction === "rtl") {
          expect(leaves.filter((leaf) => leaf.type === "text").map((leaf) => leaf.type === "text" && leaf.align), label)
            .not.toContain("left");
        }
      }
    }
  });

  it("materializes each pack in an RTL locale as valid mirrored screens", () => {
    for (const pack of styledPacks()) {
      const source = project();
      source.layouts[0]!.mode = "isolated";
      const { project: next, screens } = createScreensFromTemplatePack(
        setLocaleDirection(createScreensFromTemplatePack(source, "default", pack, "ar", storeSpecs).project, "default", "ar", "rtl"),
        "default", pack, "ar", storeSpecs,
      );
      expect(screens.every((screen) => screen.direction === "rtl"), pack.id).toBe(true);
      expect(parseProject(next)).toEqual(next);
    }
  });
});
