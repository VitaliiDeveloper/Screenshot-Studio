// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Project } from "./schema.js";
import {
  addScreenToProject,
  cloneLocaleSet,
  cloneScreenWithFreshIds,
  ensureStoreOutputFamily,
  ensureStoreTargetVariant,
  findUnresolvedFonts,
  assertProjectFontsResolved,
  formatUnresolvedFontsError,
  parseScreenPlacement,
  recomputeManifests,
  removeScreenFromProject,
  removeStoreTargetVariant,
  removeLocaleSet,
  reorderScreenInProject,
  resizeRootArtboard,
  resizeStoreOutputArtboards,
  setLocaleDirection,
  slugify,
  uniqueId,
} from "./project-ops.js";

function sampleProject(): Project {
  return {
    meta: { name: "T", schemaVersion: 10 },
    mode: "connected",
    platforms: ["apple"],
    locales: ["en"],
    fonts: [],
    screens: [
      {
        id: "hero",
        name: "Hero",
        platform: "apple",
        device: "iphone",
        locale: "en",
        direction: "ltr",
        artboard: { width: 1320, height: 2868 },
        background: { type: "solid", color: "#101827" },
        elements: [],
      },
      {
        id: "details",
        name: "Details",
        platform: "apple",
        device: "iphone",
        locale: "en",
        direction: "ltr",
        artboard: { width: 1320, height: 2868 },
        background: { type: "solid", color: "#101827" },
        elements: [],
      },
    ],
  };
}

describe("project-ops", () => {
  it("slugify and uniqueId produce stable free ids", () => {
    expect(slugify("Hello World")).toBe("hello-world");
    expect(uniqueId("hero", sampleProject().screens)).toBe("hero-2");
  });

  it("parseScreenPlacement accepts only schema pairs", () => {
    expect(parseScreenPlacement("apple", "iphone")).toEqual({ platform: "apple", device: "iphone" });
    expect(parseScreenPlacement("apple", "phone")).toBeNull();
    expect(parseScreenPlacement("android", "phone")).toEqual({ platform: "android", device: "phone" });
    expect(parseScreenPlacement("apple", "macos")).toEqual({ platform: "apple", device: "macos" });
    expect(parseScreenPlacement("apple", "tvos")).toEqual({ platform: "apple", device: "tvos" });
    expect(parseScreenPlacement("apple", "watchos")).toEqual({ platform: "apple", device: "watchos" });
    expect(parseScreenPlacement("windows", "desktop")).toEqual({ platform: "windows", device: "desktop" });
    expect(parseScreenPlacement("windows", "iphone")).toBeNull();
  });

  it("addScreenToProject appends and recomputes manifests", () => {
    const project = addScreenToProject(sampleProject(), {
      id: "ipad-hero",
      name: "iPad Hero",
      platform: "apple",
      device: "ipad",
      locale: "uk",
      artboard: { width: 2048, height: 2732 },
    });
    expect(project.mode).toBe("connected");
    expect(project.locales).toEqual(["en", "uk"]);
    expect(project.screens.at(-1)).toMatchObject({
      id: "ipad-hero",
      platform: "apple",
      device: "ipad",
      locale: "uk",
      direction: "ltr",
      artboard: { width: 2048, height: 2732 },
    });
  });

  it("creates an independent exact store-target variant without mutating the root", () => {
    const source = sampleProject();
    source.screens[0]!.elements = [{
      id: "headline", type: "text", x: 100, y: 200, width: 500, height: 100,
      rotation: 0, opacity: 1, locked: false, visible: true,
      content: "Hello", fontFamily: "Inter", size: 60, weight: 400,
      lineHeight: 1.2, letterSpacing: 0, align: "left", color: "#FFFFFF",
    }];
    const result = ensureStoreTargetVariant(source, "hero", {
      id: "6.5", width: 1284, height: 2778,
    });

    expect(result.created).toBe(true);
    expect(source.screens).toHaveLength(2);
    expect(result.project.screens).toHaveLength(3);
    expect(result.variant).toMatchObject({
      name: "Hero", variantOf: "hero", storeTargetId: "6.5",
      artboard: { width: 1284, height: 2778 },
    });
    expect(result.variant.id).not.toBe("hero");
    expect(result.variant.elements[0]!.id).not.toBe("headline");
    expect(result.variant.elements[0]!.width).toBeLessThan(500);
    expect(source.screens[0]!.artboard).toEqual({ width: 1320, height: 2868 });

    const again = ensureStoreTargetVariant(result.project, "hero", {
      id: "6.5", width: 1284, height: 2778,
    });
    expect(again.created).toBe(false);
    expect(again.variant.id).toBe(result.variant.id);
    expect(again.project).toBe(result.project);
  });

  it("resizes a root artboard and its composition atomically", () => {
    const source = sampleProject();
    source.screens[0]!.artboard = { width: 660, height: 1434 };
    source.screens[0]!.elements = [{
      id: "headline", type: "text", x: 40, y: 100, width: 580, height: 200,
      rotation: 0, opacity: 1, locked: false, visible: true,
      content: "Hello", fontFamily: "Inter", size: 72, weight: 400,
      lineHeight: 1.2, letterSpacing: 2, align: "left", color: "#FFFFFF",
    }];

    const resized = resizeRootArtboard(source, "hero", { width: 1320, height: 2868 });

    expect(source.screens[0]!.artboard).toEqual({ width: 660, height: 1434 });
    expect(resized.screens[0]!.artboard).toEqual({ width: 1320, height: 2868 });
    expect(resized.screens[0]!.elements[0]).toMatchObject({
      x: 80, y: 200, width: 1160, height: 400, size: 144, letterSpacing: 4,
    });
    expect(resized.screens[1]).toBe(source.screens[1]);
  });

  it("refuses to resize an exact target variant", () => {
    const withVariant = ensureStoreTargetVariant(sampleProject(), "hero", {
      id: "6.5", width: 1284, height: 2778,
    }).project;
    const variant = withVariant.screens.find((screen) => screen.storeTargetId === "6.5")!;

    expect(() => resizeRootArtboard(withVariant, variant.id, { width: 1000, height: 2000 }))
      .toThrow(/fixed artboards/);
  });

  it("resizes every master screen in one store output set", () => {
    const source = sampleProject();
    source.screens.forEach((screen) => {
      screen.artboard = { width: 660, height: 1434 };
    });

    const resized = resizeStoreOutputArtboards(source, "hero", { width: 1320, height: 2868 });

    expect(resized.screens.filter((screen) => screen.variantOf === undefined))
      .toHaveLength(2);
    expect(resized.screens.every((screen) =>
      screen.artboard.width === 1320 && screen.artboard.height === 2868
    )).toBe(true);
  });

  it("creates one independent full store-output family and reopens it idempotently", () => {
    const source = sampleProject();
    source.screens[0]!.elements = [{
      id: "shape", type: "shape", x: 100, y: 200, width: 500, height: 100,
      rotation: 0, opacity: 1, locked: false, visible: true,
      kind: "rect", fill: "#FFFFFF", radius: 20,
    }];
    const result = ensureStoreOutputFamily(source, "hero", "apple", "ipad", {
      id: "13", width: 2064, height: 2752,
    });

    expect(result.created).toBe(true);
    expect(source.platforms).toEqual(["apple"]);
    expect(source.screens).toHaveLength(2);
    expect(result.project.platforms).toEqual(["apple"]);
    const ipadRoots = result.project.screens.filter((screen) =>
      screen.platform === "apple" && screen.device === "ipad",
    );
    expect(ipadRoots).toHaveLength(2);
    expect(ipadRoots.map((screen) => screen.name)).toEqual(["Hero", "Details"]);
    expect(ipadRoots.every((screen) =>
      screen.variantOf === undefined
      && screen.storeTargetId === undefined
      && screen.artboard.width === 2064
      && screen.artboard.height === 2752
      && !["hero", "details"].includes(screen.id)
    )).toBe(true);
    expect(ipadRoots[0]!.elements[0]!.id).not.toBe("shape");
    expect(source.screens[0]!.artboard).toEqual({ width: 1320, height: 2868 });

    const again = ensureStoreOutputFamily(result.project, "hero", "apple", "ipad", {
      id: "13", width: 2064, height: 2752,
    });
    expect(again.created).toBe(false);
    expect(again.firstScreen.id).toBe(ipadRoots[0]!.id);
    expect(again.project).toBe(result.project);
  });

  it("removes one target variant and cascades variants when their root is removed", () => {
    const first = ensureStoreTargetVariant(sampleProject(), "hero", {
      id: "6.5", width: 1284, height: 2778,
    }).project;
    const withoutVariant = removeStoreTargetVariant(first, "hero", "6.5");
    expect(withoutVariant.screens.map((screen) => screen.id)).toEqual(["hero", "details"]);

    const recreated = ensureStoreTargetVariant(first, "details", {
      id: "6.5", width: 1284, height: 2778,
    }).project;
    const withoutRoot = removeScreenFromProject(recreated, "details");
    expect(withoutRoot.screens).toHaveLength(2);
    expect(withoutRoot.screens.every((screen) => screen.id === "hero" || screen.variantOf === "hero")).toBe(true);
  });

  it("addScreenToProject preserves an explicit RTL direction", () => {
    const project = addScreenToProject(sampleProject(), {
      name: "Arabic Hero",
      platform: "apple",
      device: "iphone",
      locale: "ar",
      direction: "rtl",
      artboard: { width: 1320, height: 2868 },
    });

    expect(project.screens.at(-1)).toMatchObject({ locale: "ar", direction: "rtl" });
  });

  it("addScreenToProject inherits an existing locale direction and defaults a new locale to ltr", () => {
    const rtl = setLocaleDirection(sampleProject(), "en", "rtl");
    const sameLocale = addScreenToProject(rtl, {
      name: "More",
      platform: "apple",
      device: "iphone",
      locale: "en",
      artboard: { width: 1320, height: 2868 },
    });
    const newLocale = addScreenToProject(sameLocale, {
      name: "Ukrainian",
      platform: "apple",
      device: "iphone",
      locale: "uk",
      artboard: { width: 1320, height: 2868 },
    });

    expect(sameLocale.screens.at(-1)!.direction).toBe("rtl");
    expect(newLocale.screens.at(-1)!.direction).toBe("ltr");
  });

  it("removeScreenFromProject refuses the last screen and recomputes platforms", () => {
    const withAndroid = addScreenToProject(sampleProject(), {
      name: "Android",
      platform: "android",
      device: "phone",
      locale: "en",
      artboard: { width: 1080, height: 1920 },
    });
    expect(withAndroid.platforms).toEqual(["apple", "android"]);
    const androidId = withAndroid.screens.at(-1)!.id;
    const withoutAndroid = removeScreenFromProject(withAndroid, androidId);
    expect(withoutAndroid.platforms).toEqual(["apple"]);
    expect(() => removeScreenFromProject(withoutAndroid, "details")).not.toThrow();
    const oneLeft = removeScreenFromProject(withoutAndroid, "details");
    expect(() => removeScreenFromProject(oneLeft, "hero")).toThrow(/last screen/);
  });

  it("reorderScreenInProject uses 1-based positions", () => {
    const project = reorderScreenInProject(sampleProject(), "details", 1);
    expect(project.screens.map((s) => s.id)).toEqual(["details", "hero"]);
  });

  it("recomputeManifests derives platforms/locales from screens", () => {
    const project = recomputeManifests({
      ...sampleProject(),
      platforms: ["android"],
      locales: ["de"],
    });
    expect(project.platforms).toEqual(["apple"]);
    expect(project.locales).toEqual(["en"]);
  });

  it("cloneScreenWithFreshIds regenerates screen and element ids", () => {
    const src = sampleProject().screens[0]!;
    src.elements = [
      {
        id: "headline",
        type: "text",
        x: 0,
        y: 0,
        width: 100,
        height: 40,
        rotation: 0,
        opacity: 1,
        locked: false,
        visible: true,
        content: "Hi",
        fontFamily: "sans-serif",
        size: 24,
        weight: 400,
        lineHeight: 1.2,
        letterSpacing: 0,
        align: "left",
        color: "#fff",
      },
    ];
    const copy = cloneScreenWithFreshIds(src);
    expect(copy.id).not.toBe(src.id);
    expect(copy.elements[0]!.id).not.toBe("headline");
    expect(copy.name).toBe("Hero copy");
  });

  it("clones group and child ids and resolves grouped fonts", () => {
    const source = sampleProject();
    source.screens[0]!.elements = [{
      id: "group", type: "group", x: 10, y: 20, width: 200, height: 100,
      rotation: 0, opacity: 1, locked: false, visible: true,
      children: [{
        id: "child", type: "text", x: 0, y: 0, width: 200, height: 100,
        rotation: 0, opacity: 1, locked: false, visible: true,
        content: "Grouped", fontFamily: "Missing", size: 30, weight: 700,
        lineHeight: 1.2, letterSpacing: 0, align: "left", color: "#FFFFFF",
      }],
    }];

    expect(findUnresolvedFonts(source)).toEqual([{ family: "Missing", weight: 700 }]);
    const copy = cloneScreenWithFreshIds(source.screens[0]!);
    const copiedGroup = copy.elements[0]!;
    expect(copiedGroup.id).not.toBe("group");
    expect(copiedGroup.type === "group" && copiedGroup.children[0]!.id).not.toBe("child");
  });

  it("cloneLocaleSet appends an independent target set in source order", () => {
    let source = sampleProject();
    source.screens[0]!.elements = [
      {
        id: "hero-shot",
        type: "screenshot",
        x: 10,
        y: 20,
        width: 600,
        height: 1200,
        rotation: 0,
        opacity: 1,
        locked: false,
        visible: true,
        assetUrl: "assets/shared/hero.png",
        fit: "cover",
        cornerRadius: 24,
      },
    ];

    source = ensureStoreTargetVariant(source, "hero", {
      id: "6.5", width: 1284, height: 2778,
    }).project;
    const result = cloneLocaleSet(source, "en", "ar");
    const targets = result.screens.filter((screen) => screen.locale === "ar");
    const clonedRoot = targets.find((screen) => screen.storeTargetId === undefined)!;
    const clonedVariant = targets.find((screen) => screen.storeTargetId === "6.5")!;

    expect(result.locales).toEqual(["en", "ar"]);
    expect(result.screens.slice(-3)).toEqual(targets);
    expect(targets.map((screen) => screen.name)).toEqual(["Hero", "Details", "Hero"]);
    expect(targets.map((screen) => screen.id)).not.toEqual(["hero", "details", "hero-65"]);
    expect(clonedVariant.variantOf).toBe(clonedRoot.id);
    expect(clonedRoot.elements[0]!.id).not.toBe("hero-shot");
    expect(clonedRoot.elements[0]).toMatchObject({
      type: "screenshot",
      assetUrl: "assets/shared/hero.png",
      x: 10,
      y: 20,
    });
    expect(source.locales).toEqual(["en"]);
    expect(source.screens).toHaveLength(3);
  });

  it("cloneLocaleSet rejects invalid source and target locales", () => {
    const project = sampleProject();

    expect(() => cloneLocaleSet(project, "missing", "uk")).toThrow(/Unknown source locale/);
    expect(() => cloneLocaleSet(project, "en", "en")).toThrow(/already exists/);
    expect(() => cloneLocaleSet(project, "en", "   ")).toThrow(/must not be empty/);
  });

  it("removeLocaleSet removes the whole set and protects the last locale", () => {
    const project = cloneLocaleSet(sampleProject(), "en", "uk");
    const result = removeLocaleSet(project, "en");

    expect(result.locales).toEqual(["uk"]);
    expect(result.screens.map((screen) => screen.locale)).toEqual(["uk", "uk"]);
    expect(() => removeLocaleSet(result, "missing")).toThrow(/Unknown locale/);
    expect(() => removeLocaleSet(result, "uk")).toThrow(/last locale/);
  });

  it("setLocaleDirection mirrors placement once and is reversible", () => {
    const source = sampleProject();
    source.screens[0]!.elements = [
      {
        id: "shot",
        type: "screenshot",
        x: 100,
        y: 200,
        width: 600,
        height: 1200,
        rotation: 8,
        opacity: 1,
        locked: false,
        visible: true,
        assetUrl: "assets/hero.png",
        fit: "cover",
        cornerRadius: 20,
      },
      {
        id: "headline",
        type: "text",
        x: 80,
        y: 40,
        width: 800,
        height: 200,
        rotation: 0,
        opacity: 1,
        locked: false,
        visible: true,
        content: "Hello",
        fontFamily: "Inter",
        size: 96,
        weight: 700,
        lineHeight: 1.2,
        letterSpacing: 0,
        align: "left",
        color: "#FFFFFF",
      },
    ];

    const rtl = setLocaleDirection(source, "en", "rtl");
    const [shot, headline] = rtl.screens[0]!.elements;

    expect(rtl.screens.every((screen) => screen.direction === "rtl")).toBe(true);
    expect(shot).toMatchObject({
      type: "screenshot",
      x: 620,
      y: 200,
      width: 600,
      rotation: 8,
      assetUrl: "assets/hero.png",
    });
    expect(headline).toMatchObject({ type: "text", x: 440, align: "right", content: "Hello" });
    expect(setLocaleDirection(rtl, "en", "rtl")).toEqual(rtl);
    expect(setLocaleDirection(rtl, "en", "ltr")).toEqual(source);
    expect(() => setLocaleDirection(source, "missing", "rtl")).toThrow(/Unknown locale/);
  });

  it("setLocaleDirection mirrors grouped children without reflecting media state", () => {
    const source = sampleProject();
    source.screens[0]!.elements = [{
      id: "group", type: "group", x: 100, y: 20, width: 300, height: 200,
      rotation: 0, opacity: 1, locked: false, visible: true,
      children: [
        {
          id: "copy", type: "text", x: 20, y: 10, width: 100, height: 40,
          rotation: 0, opacity: 1, locked: false, visible: true,
          content: "Hello", fontFamily: "Inter", size: 24, weight: 400,
          lineHeight: 1.2, letterSpacing: 0, align: "left", color: "#FFFFFF",
        },
        {
          id: "shot", type: "screenshot", x: 180, y: 60, width: 80, height: 100,
          rotation: 0, opacity: 1, locked: false, visible: true,
          assetUrl: "assets/shot.png", fit: "contain", cornerRadius: 8,
        },
      ],
    }];

    const rtl = setLocaleDirection(source, "en", "rtl");
    const grouped = rtl.screens[0]!.elements[0]!;
    expect(grouped).toMatchObject({ x: 920 });
    if (grouped.type !== "group") throw new Error("expected group");
    expect(grouped.children[0]).toMatchObject({ x: 180, align: "right" });
    expect(grouped.children[1]).toMatchObject({ x: 40, assetUrl: "assets/shot.png", fit: "contain" });
    expect(setLocaleDirection(rtl, "en", "ltr")).toEqual(source);
  });

  it("cloneLocaleSet can bake a target direction while preserving the source", () => {
    const source = sampleProject();
    source.screens[0]!.elements = [{
      id: "title",
      type: "text",
      x: 100,
      y: 100,
      width: 500,
      height: 100,
      rotation: 0,
      opacity: 1,
      locked: false,
      visible: true,
      content: "Title",
      fontFamily: "Inter",
      size: 64,
      weight: 700,
      lineHeight: 1.2,
      letterSpacing: 0,
      align: "left",
      color: "#FFFFFF",
    }];

    const project = cloneLocaleSet(source, "en", "ar", "rtl");
    const target = project.screens.find((screen) => screen.locale === "ar")!;

    expect(target.direction).toBe("rtl");
    expect(target.elements[0]).toMatchObject({ x: 720, align: "right" });
    expect(source.screens[0]!.elements[0]).toMatchObject({ x: 100, align: "left" });
  });

  it("finds each text font identity absent from project assets once", () => {
    const project = sampleProject();
    project.screens[0]!.elements = [
      {
        id: "title", type: "text", x: 0, y: 0, width: 100, height: 100,
        content: "Title", fontFamily: "Inter", weight: 700, size: 24, color: "#FFFFFF",
        rotation: 0, opacity: 1, locked: false, visible: true,
        lineHeight: 1.2, letterSpacing: 0, align: "left",
      },
      {
        id: "body", type: "text", x: 0, y: 100, width: 100, height: 100,
        content: "Body", fontFamily: "Inter", weight: 400, size: 24, color: "#FFFFFF",
        rotation: 0, opacity: 1, locked: false, visible: true,
        lineHeight: 1.2, letterSpacing: 0, align: "left",
      },
      {
        id: "title-again", type: "text", x: 0, y: 200, width: 100, height: 100,
        content: "Again", fontFamily: "Inter", weight: 700, size: 24, color: "#FFFFFF",
        rotation: 0, opacity: 1, locked: false, visible: true,
        lineHeight: 1.2, letterSpacing: 0, align: "left",
      },
    ];
    project.fonts = [{ family: "Inter", source: "uploaded", path: "assets/fonts/inter-400.ttf", weight: 400 }];

    expect(findUnresolvedFonts(project)).toEqual([{ family: "Inter", weight: 700 }]);
    expect(formatUnresolvedFontsError([{ family: "Inter", weight: 700 }]))
      .toContain("Fonts dialog or with screenshots font add");
    expect(() => assertProjectFontsResolved(project)).toThrow(/"Inter" 700/);
  });
});
