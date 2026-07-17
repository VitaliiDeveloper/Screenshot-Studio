// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Project } from "./schema.js";
import { isScreenPlacement as isScreenPlacementFromModel } from "./index.js";
import { slugify as manifestSlugify } from "./project-manifest.js";
import { isScreenPlacement as ownedScreenPlacement } from "./project-screen-ops.js";
import { ensureStoreOutputFamily as ownedStoreOutputFamily } from "./project-output-ops.js";
import { setLocaleDirection as ownedLocaleDirection } from "./project-locale-ops.js";
import {
  addScreenToProject,
  cloneLocaleSet,
  cloneScreenWithFreshIds,
  ensureStoreOutputFamily,
  ensureStoreTargetVariant,
  findUnresolvedFonts,
  assertProjectFontsResolved,
  formatUnresolvedFontsError,
  isScreenPlacement,
  parseScreenPlacement,
  removeScreenFromProject,
  removeStoreTargetVariant,
  removeLocaleSet,
  reorderScreenInProject,
  resizeScreenArtboard,
  resizeStoreOutputArtboards,
  setLocaleDirection,
  slugify,
  uniqueId,
} from "./project-ops.js";

function sampleProject(): Project {
  return {
    meta: { name: "T", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [{
      id: "default", name: "Default", mode: "connected",
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
    }],
  };
}

describe("project-ops", () => {
  it("keeps the compatibility barrel wired to its owning runtime operations", () => {
    expect(slugify).toBe(manifestSlugify);
    expect(isScreenPlacement).toBe(ownedScreenPlacement);
    expect(ensureStoreOutputFamily).toBe(ownedStoreOutputFamily);
    expect(setLocaleDirection).toBe(ownedLocaleDirection);
  });

  it("slugify and uniqueId produce stable free ids", () => {
    expect(slugify("Hello World")).toBe("hello-world");
    expect(uniqueId("hero", sampleProject().layouts[0]!.screens)).toBe("hero-2");
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

  it("isScreenPlacement preserves the boolean compatibility API", () => {
    expect(isScreenPlacement("apple", "iphone")).toBe(true);
    expect(isScreenPlacement("apple", "phone")).toBe(false);
    expect(isScreenPlacementFromModel).toBe(isScreenPlacement);
  });

  it("addScreenToProject appends inside one layout", () => {
    const project = addScreenToProject(sampleProject(), "default", {
      id: "ipad-hero",
      name: "iPad Hero",
      platform: "apple",
      device: "ipad",
      locale: "uk",
      artboard: { width: 2048, height: 2732 },
    });
    expect(project.layouts[0]!.mode).toBe("connected");
    expect(project.layouts[0]!.screens.at(-1)).toMatchObject({
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
    source.layouts[0]!.screens[0]!.elements = [{
      id: "headline", type: "text", x: 100, y: 200, width: 500, height: 100,
      rotation: 0, opacity: 1, locked: false, visible: true,
      content: "Hello", fontFamily: "Inter", size: 60, weight: 400,
      lineHeight: 1.2, letterSpacing: 0, align: "left", color: "#FFFFFF",
    }];
    const result = ensureStoreTargetVariant(source, "default", "hero", {
      id: "6.5", width: 1284, height: 2778,
    });

    expect(result.created).toBe(true);
    expect(source.layouts[0]!.screens).toHaveLength(2);
    expect(result.project.layouts[0]!.screens).toHaveLength(3);
    expect(result.variant).toMatchObject({
      name: "Hero", variantOf: "hero", storeTargetId: "6.5",
      artboard: { width: 1284, height: 2778 },
    });
    expect(result.variant.id).not.toBe("hero");
    expect(result.variant.elements[0]!.id).not.toBe("headline");
    expect(result.variant.elements[0]!.width).toBeLessThan(500);
    expect(source.layouts[0]!.screens[0]!.artboard).toEqual({ width: 1320, height: 2868 });

    const again = ensureStoreTargetVariant(result.project, "default", "hero", {
      id: "6.5", width: 1284, height: 2778,
    });
    expect(again.created).toBe(false);
    expect(again.variant.id).toBe(result.variant.id);
    expect(again.project).toBe(result.project);
  });

  it("resizes one screen artboard and its composition atomically", () => {
    const source = sampleProject();
    source.layouts[0]!.screens[0]!.artboard = { width: 660, height: 1434 };
    source.layouts[0]!.screens[0]!.elements = [{
      id: "headline", type: "text", x: 40, y: 100, width: 580, height: 200,
      rotation: 0, opacity: 1, locked: false, visible: true,
      content: "Hello", fontFamily: "Inter", size: 72, weight: 400,
      lineHeight: 1.2, letterSpacing: 2, align: "left", color: "#FFFFFF",
      shadow: { color: "#000000", blur: 4, offsetX: -3, offsetY: 5, opacity: 0.8 },
    }, {
      id: "card", type: "shape", x: 20, y: 40, width: 100, height: 80,
      rotation: 0, opacity: 1, locked: false, visible: true,
      kind: "rect", fill: "#FFFFFF", radius: 6,
      stroke: { color: "#000000", width: 6 },
    }];

    const resized = resizeScreenArtboard(source, "default", "hero", { width: 1320, height: 2868 });

    expect(source.layouts[0]!.screens[0]!.artboard).toEqual({ width: 660, height: 1434 });
    expect(resized.layouts[0]!.screens[0]!.artboard).toEqual({ width: 1320, height: 2868 });
    expect(resized.layouts[0]!.screens[0]!.elements[0]).toMatchObject({
      x: 80, y: 200, width: 1160, height: 400, size: 144, letterSpacing: 4,
      shadow: { blur: 8, offsetX: -6, offsetY: 10 },
    });
    expect(resized.layouts[0]!.screens[0]!.elements[1]).toMatchObject({
      x: 40, y: 80, width: 200, height: 160, radius: 12,
      stroke: { width: 12 },
    });
    expect(resized.layouts[0]!.screens[1]).toEqual(source.layouts[0]!.screens[1]);
  });

  it("scales render-bearing effects with an artboard fit", () => {
    const source = sampleProject();
    source.layouts[0]!.screens[0]!.artboard = { width: 100, height: 100 };
    source.layouts[0]!.screens[0]!.elements = [
      {
        id: "headline", type: "text", x: 10, y: 10, width: 80, height: 20,
        rotation: 0, opacity: 1, locked: false, visible: true,
        content: "Hello", fontFamily: "Inter", size: 10, weight: 400,
        lineHeight: 1.2, letterSpacing: 1, align: "left", color: "#FFFFFF",
        shadow: { color: "#000000", blur: 12, offsetX: 4, offsetY: -6, opacity: 0.5 },
      },
      {
        id: "group", type: "group", x: 10, y: 40, width: 80, height: 40,
        rotation: 0, opacity: 1, locked: false, visible: true,
        children: [{
          id: "card", type: "shape", x: 0, y: 0, width: 80, height: 40,
          rotation: 0, opacity: 1, locked: false, visible: true,
          kind: "rect", fill: "#101827", radius: 6,
          stroke: { color: "#FFFFFF", width: 4 },
        }],
      },
    ];

    const resized = resizeScreenArtboard(source, "default", "hero", { width: 200, height: 200 });

    expect(resized.layouts[0]!.screens[0]!.elements).toMatchObject([
      {
        type: "text",
        shadow: { color: "#000000", blur: 24, offsetX: 8, offsetY: -12, opacity: 0.5 },
      },
      {
        type: "group",
        children: [{
          type: "shape",
          radius: 12,
          stroke: { color: "#FFFFFF", width: 8 },
        }],
      },
    ]);
  });

  it("rejects artboard fits that exceed bounded visual metrics", () => {
    const source = sampleProject();
    source.layouts[0]!.screens[0]!.artboard = { width: 100, height: 100 };
    source.layouts[0]!.screens[0]!.elements = [{
      id: "headline", type: "text", x: 10, y: 10, width: 80, height: 20,
      rotation: 0, opacity: 1, locked: false, visible: true,
      content: "Hello", fontFamily: "Inter", size: 10, weight: 400,
      lineHeight: 1.2, letterSpacing: 1, align: "left", color: "#FFFFFF",
      shadow: { color: "#000000", blur: 60, offsetX: 0, offsetY: 4, opacity: 0.5 },
    }];
    const original = structuredClone(source);

    expect(() => resizeScreenArtboard(source, "default", "hero", { width: 200, height: 200 }))
      .toThrow('Cannot scale text shadow blur above 100 for element "headline"');
    expect(source).toEqual(original);
  });

  it("resizes one store target output set without changing roots or sibling targets", () => {
    let withTargets = sampleProject();
    for (const rootId of ["hero", "details"]) {
      withTargets = ensureStoreTargetVariant(withTargets, "default", rootId, {
        id: "6.5", width: 1284, height: 2778,
      }).project;
      withTargets = ensureStoreTargetVariant(withTargets, "default", rootId, {
        id: "5.5", width: 1242, height: 2688,
      }).project;
    }
    const source = withTargets.layouts[0]!.screens.find((screen) =>
      screen.variantOf === "hero" && screen.storeTargetId === "6.5"
    )!;
    const originalRoots = withTargets.layouts[0]!.screens.filter((screen) => screen.storeTargetId === undefined);
    const originalSiblingTarget = withTargets.layouts[0]!.screens.filter((screen) => screen.storeTargetId === "5.5");

    const resized = resizeStoreOutputArtboards(withTargets, "default", source.id, {
      width: 642,
      height: 1389,
    });

    const resizedTarget = resized.layouts[0]!.screens.filter((screen) => screen.storeTargetId === "6.5");
    expect(resizedTarget).toHaveLength(2);
    expect(resizedTarget.every((screen) =>
      screen.artboard.width === 642 && screen.artboard.height === 1389
    )).toBe(true);
    expect(resized.layouts[0]!.screens.filter((screen) => screen.storeTargetId === undefined))
      .toEqual(originalRoots);
    expect(resized.layouts[0]!.screens.filter((screen) => screen.storeTargetId === "5.5"))
      .toEqual(originalSiblingTarget);
  });

  it("resizes every master screen in one store output set", () => {
    const source = sampleProject();
    source.layouts[0]!.screens.forEach((screen) => {
      screen.artboard = { width: 660, height: 1434 };
    });

    const resized = resizeStoreOutputArtboards(source, "default", "hero", { width: 1320, height: 2868 });

    expect(resized.layouts[0]!.screens.filter((screen) => screen.variantOf === undefined))
      .toHaveLength(2);
    expect(resized.layouts[0]!.screens.every((screen) =>
      screen.artboard.width === 1320 && screen.artboard.height === 2868
    )).toBe(true);
  });

  it("creates one independent full store-output family and reopens it idempotently", () => {
    const source = sampleProject();
    source.layouts[0]!.screens[0]!.elements = [{
      id: "shape", type: "shape", x: 100, y: 200, width: 500, height: 100,
      rotation: 0, opacity: 1, locked: false, visible: true,
      kind: "rect", fill: "#FFFFFF", radius: 20,
    }];
    const result = ensureStoreOutputFamily(source, "default", "hero", "apple", "ipad", {
      id: "13", width: 2064, height: 2752,
    });

    expect(result.created).toBe(true);
    expect(source.layouts[0]!.screens).toHaveLength(2);
    const ipadRoots = result.project.layouts[0]!.screens.filter((screen) =>
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
    expect(source.layouts[0]!.screens[0]!.artboard).toEqual({ width: 1320, height: 2868 });

    const again = ensureStoreOutputFamily(result.project, "default", "hero", "apple", "ipad", {
      id: "13", width: 2064, height: 2752,
    });
    expect(again.created).toBe(false);
    expect(again.firstScreen.id).toBe(ipadRoots[0]!.id);
    expect(again.project).toBe(result.project);
  });

  it("creates new watchOS output families with 3.5x custom masters", () => {
    const source = sampleProject();
    const result = ensureStoreOutputFamily(source, "default", "hero", "apple", "watchos", {
      id: "ultra-3", width: 422, height: 514,
    });

    const watchRoots = result.project.layouts[0]!.screens.filter((screen) =>
      screen.platform === "apple"
      && screen.device === "watchos"
      && screen.variantOf === undefined,
    );
    expect(result.created).toBe(true);
    expect(watchRoots).toHaveLength(2);
    expect(watchRoots.every((screen) =>
      screen.storeTargetId === undefined
      && screen.artboard.width === 1477
      && screen.artboard.height === 1799
    )).toBe(true);
    expect(source.layouts[0]!.screens.map((screen) => screen.artboard)).toEqual([
      { width: 1320, height: 2868 },
      { width: 1320, height: 2868 },
    ]);

    const variant = ensureStoreTargetVariant(result.project, "default", watchRoots[0]!.id, {
      id: "series-11", width: 416, height: 496,
    }).variant;
    expect(variant).toMatchObject({
      variantOf: watchRoots[0]!.id,
      storeTargetId: "series-11",
      artboard: { width: 1456, height: 1736 },
    });
  });

  it("reuses an existing target output set size for newly added variants", () => {
    const family = ensureStoreOutputFamily(sampleProject(), "default", "hero", "apple", "watchos", {
      id: "ultra-3", width: 422, height: 514,
    });
    const watchRoots = family.project.layouts[0]!.screens.filter((screen) =>
      screen.platform === "apple"
      && screen.device === "watchos"
      && screen.variantOf === undefined
    );
    const first = ensureStoreTargetVariant(family.project, "default", watchRoots[0]!.id, {
      id: "series-11", width: 416, height: 496,
    });
    const resized = resizeStoreOutputArtboards(first.project, "default", first.variant.id, {
      width: 832,
      height: 992,
    });

    const second = ensureStoreTargetVariant(resized, "default", watchRoots[1]!.id, {
      id: "series-11", width: 416, height: 496,
    });

    expect(second.variant.artboard).toEqual({ width: 832, height: 992 });
  });

  it("derives watchOS masters from the supplied lead dimensions", () => {
    const result = ensureStoreOutputFamily(sampleProject(), "default", "hero", "apple", "watchos", {
      id: "custom-watch-lead", width: 400, height: 500,
    });

    expect(result.firstScreen.artboard).toEqual({ width: 1400, height: 1750 });
  });

  it("rejects watchOS lead dimensions that cannot produce an integer 3.5x master", () => {
    const source = sampleProject();

    expect(() => ensureStoreOutputFamily(source, "default", "hero", "apple", "watchos", {
      id: "fractional-watch-lead", width: 401, height: 501,
    })).toThrow(/derived artboard must use integer dimensions/);
    expect(source.layouts[0]!.screens).toHaveLength(2);
  });

  it("rejects watchOS variant dimensions that cannot produce an integer 3.5x artboard", () => {
    const family = ensureStoreOutputFamily(sampleProject(), "default", "hero", "apple", "watchos", {
      id: "ultra-3", width: 422, height: 514,
    });
    const before = family.project;

    expect(() => ensureStoreTargetVariant(before, "default", family.firstScreen.id, {
      id: "fractional-watch-target", width: 401, height: 501,
    })).toThrow(/derived artboard must use integer dimensions/);
    expect(before.layouts[0]!.screens).toHaveLength(4);
  });

  it("reopens an existing fixed watchOS family without resizing it", () => {
    const source = sampleProject();
    source.layouts[0]!.screens.push({
      ...structuredClone(source.layouts[0]!.screens[0]!),
      id: "existing-watch",
      platform: "apple",
      device: "watchos",
      artboard: { width: 422, height: 514 },
      elements: [],
    });

    const result = ensureStoreOutputFamily(source, "default", "hero", "apple", "watchos", {
      id: "ultra-3", width: 422, height: 514,
    });

    expect(result.created).toBe(false);
    expect(result.project).toBe(source);
    expect(result.firstScreen.id).toBe("existing-watch");
    expect(result.firstScreen.artboard).toEqual({ width: 422, height: 514 });
  });

  it("removes one target variant and cascades variants when their root is removed", () => {
    const first = ensureStoreTargetVariant(sampleProject(), "default", "hero", {
      id: "6.5", width: 1284, height: 2778,
    }).project;
    const withoutVariant = removeStoreTargetVariant(first, "default", "hero", "6.5");
    expect(withoutVariant.layouts[0]!.screens.map((screen) => screen.id)).toEqual(["hero", "details"]);

    const recreated = ensureStoreTargetVariant(first, "default", "details", {
      id: "6.5", width: 1284, height: 2778,
    }).project;
    expect(() => removeScreenFromProject(recreated, "default", "details"))
      .toThrow(/has 1 store target variant.*cascade/i);
    const withoutRoot = removeScreenFromProject(recreated, "default", "details", { cascadeVariants: true });
    expect(withoutRoot.layouts[0]!.screens).toHaveLength(2);
    expect(withoutRoot.layouts[0]!.screens.every((screen) => screen.id === "hero" || screen.variantOf === "hero")).toBe(true);
  });

  it("refuses to remove the last root screen for one locale", () => {
    const withUkrainian = addScreenToProject(sampleProject(), "default", {
      id: "uk-root",
      platform: "apple",
      device: "iphone",
      locale: "uk",
      artboard: { width: 1320, height: 2868 },
    });

    expect(() => removeScreenFromProject(withUkrainian, "default", "uk-root"))
      .toThrow('Cannot remove the last root screen for locale "uk"');
    expect(removeScreenFromProject(withUkrainian, "default", "details").layouts[0]!.screens.map((screen) => screen.id))
      .toContain("uk-root");
  });

  it("addScreenToProject preserves an explicit RTL direction", () => {
    const project = addScreenToProject(sampleProject(), "default", {
      name: "Arabic Hero",
      platform: "apple",
      device: "iphone",
      locale: "ar",
      direction: "rtl",
      artboard: { width: 1320, height: 2868 },
    });

    expect(project.layouts[0]!.screens.at(-1)).toMatchObject({ locale: "ar", direction: "rtl" });
  });

  it("addScreenToProject inherits an existing locale direction and defaults a new locale to ltr", () => {
    const rtl = setLocaleDirection(sampleProject(), "default", "en", "rtl");
    const sameLocale = addScreenToProject(rtl, "default", {
      name: "More",
      platform: "apple",
      device: "iphone",
      locale: "en",
      artboard: { width: 1320, height: 2868 },
    });
    const newLocale = addScreenToProject(sameLocale, "default", {
      name: "Ukrainian",
      platform: "apple",
      device: "iphone",
      locale: "uk",
      artboard: { width: 1320, height: 2868 },
    });

    expect(sameLocale.layouts[0]!.screens.at(-1)!.direction).toBe("rtl");
    expect(newLocale.layouts[0]!.screens.at(-1)!.direction).toBe("ltr");
  });

  it("removeScreenFromProject refuses the last root screen", () => {
    const withAndroid = addScreenToProject(sampleProject(), "default", {
      name: "Android",
      platform: "android",
      device: "phone",
      locale: "en",
      artboard: { width: 1080, height: 1920 },
    });
    const androidId = withAndroid.layouts[0]!.screens.at(-1)!.id;
    const withoutAndroid = removeScreenFromProject(withAndroid, "default", androidId);
    expect(() => removeScreenFromProject(withoutAndroid, "default", "details")).not.toThrow();
    const oneLeft = removeScreenFromProject(withoutAndroid, "default", "details");
    expect(() => removeScreenFromProject(oneLeft, "default", "hero")).toThrow(/last root screen.*en/);
  });

  it("reorderScreenInProject uses 1-based positions", () => {
    const project = reorderScreenInProject(sampleProject(), "default", "details", 1);
    expect(project.layouts[0]!.screens.map((s) => s.id)).toEqual(["details", "hero"]);
  });

  it("cloneScreenWithFreshIds regenerates screen and element ids", () => {
    const src = sampleProject().layouts[0]!.screens[0]!;
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
    source.layouts[0]!.screens[0]!.elements = [{
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
    const copy = cloneScreenWithFreshIds(source.layouts[0]!.screens[0]!);
    const copiedGroup = copy.elements[0]!;
    expect(copiedGroup.id).not.toBe("group");
    expect(copiedGroup.type === "group" && copiedGroup.children[0]!.id).not.toBe("child");
  });

  it("cloneLocaleSet appends an independent target set in source order", () => {
    let source = sampleProject();
    source.layouts[0]!.screens[0]!.elements = [
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

    source = ensureStoreTargetVariant(source, "default", "hero", {
      id: "6.5", width: 1284, height: 2778,
    }).project;
    const result = cloneLocaleSet(source, "default", "en", "ar");
    const targets = result.layouts[0]!.screens.filter((screen) => screen.locale === "ar");
    const clonedRoot = targets.find((screen) => screen.storeTargetId === undefined)!;
    const clonedVariant = targets.find((screen) => screen.storeTargetId === "6.5")!;

    expect(Array.from(new Set(result.layouts[0]!.screens.map((screen) => screen.locale))))
      .toEqual(["en", "ar"]);
    expect(result.layouts[0]!.screens.slice(-3)).toEqual(targets);
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
    expect(Array.from(new Set(source.layouts[0]!.screens.map((screen) => screen.locale))))
      .toEqual(["en"]);
    expect(source.layouts[0]!.screens).toHaveLength(3);
  });

  it("cloneLocaleSet rejects invalid source and target locales", () => {
    const project = sampleProject();

    expect(() => cloneLocaleSet(project, "default", "missing", "uk")).toThrow(/Unknown source locale/);
    expect(() => cloneLocaleSet(project, "default", "en", "en")).toThrow(/already exists/);
    expect(() => cloneLocaleSet(project, "default", "en", "   ")).toThrow(/must not be empty/);
  });

  it("removeLocaleSet removes the whole set and protects the last locale", () => {
    const project = cloneLocaleSet(sampleProject(), "default", "en", "uk");
    const result = removeLocaleSet(project, "default", "en");

    expect(Array.from(new Set(result.layouts[0]!.screens.map((screen) => screen.locale))))
      .toEqual(["uk"]);
    expect(result.layouts[0]!.screens.map((screen) => screen.locale)).toEqual(["uk", "uk"]);
    expect(() => removeLocaleSet(result, "default", "missing")).toThrow(/Unknown locale/);
    expect(() => removeLocaleSet(result, "default", "uk")).toThrow(/last locale/);
  });

  it("setLocaleDirection mirrors placement once and is reversible", () => {
    const source = sampleProject();
    source.layouts[0]!.screens[0]!.elements = [
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

    const rtl = setLocaleDirection(source, "default", "en", "rtl");
    const [shot, headline] = rtl.layouts[0]!.screens[0]!.elements;

    expect(rtl.layouts[0]!.screens.every((screen) => screen.direction === "rtl")).toBe(true);
    expect(shot).toMatchObject({
      type: "screenshot",
      x: 620,
      y: 200,
      width: 600,
      rotation: 8,
      assetUrl: "assets/hero.png",
    });
    expect(headline).toMatchObject({ type: "text", x: 440, align: "right", content: "Hello" });
    expect(setLocaleDirection(rtl, "default", "en", "rtl")).toEqual(rtl);
    expect(setLocaleDirection(rtl, "default", "en", "ltr")).toEqual(source);
    expect(() => setLocaleDirection(source, "default", "missing", "rtl")).toThrow(/Unknown locale/);
  });

  it("setLocaleDirection mirrors grouped children without reflecting media state", () => {
    const source = sampleProject();
    source.layouts[0]!.screens[0]!.elements = [{
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

    const rtl = setLocaleDirection(source, "default", "en", "rtl");
    const grouped = rtl.layouts[0]!.screens[0]!.elements[0]!;
    expect(grouped).toMatchObject({ x: 920 });
    if (grouped.type !== "group") throw new Error("expected group");
    expect(grouped.children[0]).toMatchObject({ x: 180, align: "right" });
    expect(grouped.children[1]).toMatchObject({ x: 40, assetUrl: "assets/shot.png", fit: "contain" });
    expect(setLocaleDirection(rtl, "default", "en", "ltr")).toEqual(source);
  });

  it("cloneLocaleSet can bake a target direction while preserving the source", () => {
    const source = sampleProject();
    source.layouts[0]!.screens[0]!.elements = [{
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

    const project = cloneLocaleSet(source, "default", "en", "ar", "rtl");
    const target = project.layouts[0]!.screens.find((screen) => screen.locale === "ar")!;

    expect(target.direction).toBe("rtl");
    expect(target.elements[0]).toMatchObject({ x: 720, align: "right" });
    expect(source.layouts[0]!.screens[0]!.elements[0]).toMatchObject({ x: 100, align: "left" });
  });

  it("finds each text font identity absent from project assets once", () => {
    const project = sampleProject();
    project.layouts[0]!.screens[0]!.elements = [
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
