// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Project } from "./schema.js";
import { isScreenPlacement as isScreenPlacementFromModel } from "./index.js";
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
  recomputeManifests,
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
  it("keeps the project-ops compatibility surface", () => {
    expect(typeof slugify).toBe("function");
    expect(typeof isScreenPlacement).toBe("function");
    expect(typeof ensureStoreOutputFamily).toBe("function");
    expect(typeof setLocaleDirection).toBe("function");
  });

  it("keeps project-ops as the declarative compatibility barrel", () => {
    const source = readFileSync(new URL("./project-ops.ts", import.meta.url), "utf8");
    const reexports = [...source.matchAll(/export \* from "(.+)";/g)]
      .map((match) => match[1]);

    expect(reexports).toEqual([
      "./project-manifest.js",
      "./project-font-ops.js",
      "./project-screen-ops.js",
      "./project-artboard-ops.js",
      "./project-output-ops.js",
      "./project-locale-ops.js",
    ]);
    expect(source).not.toMatch(/\bfunction\b/);
  });

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

  it("isScreenPlacement preserves the boolean compatibility API", () => {
    expect(isScreenPlacement("apple", "iphone")).toBe(true);
    expect(isScreenPlacement("apple", "phone")).toBe(false);
    expect(isScreenPlacementFromModel).toBe(isScreenPlacement);
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

  it("resizes one screen artboard and its composition atomically", () => {
    const source = sampleProject();
    source.screens[0]!.artboard = { width: 660, height: 1434 };
    source.screens[0]!.elements = [{
      id: "headline", type: "text", x: 40, y: 100, width: 580, height: 200,
      rotation: 0, opacity: 1, locked: false, visible: true,
      content: "Hello", fontFamily: "Inter", size: 72, weight: 400,
      lineHeight: 1.2, letterSpacing: 2, align: "left", color: "#FFFFFF",
    }];

    const resized = resizeScreenArtboard(source, "hero", { width: 1320, height: 2868 });

    expect(source.screens[0]!.artboard).toEqual({ width: 660, height: 1434 });
    expect(resized.screens[0]!.artboard).toEqual({ width: 1320, height: 2868 });
    expect(resized.screens[0]!.elements[0]).toMatchObject({
      x: 80, y: 200, width: 1160, height: 400, size: 144, letterSpacing: 4,
    });
    expect(resized.screens[1]).toBe(source.screens[1]);
  });

  it("scales render-bearing effects with an artboard fit", () => {
    const source = sampleProject();
    source.screens[0]!.artboard = { width: 100, height: 100 };
    source.screens[0]!.elements = [
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

    const resized = resizeScreenArtboard(source, "hero", { width: 200, height: 200 });

    expect(resized.screens[0]!.elements).toMatchObject([
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
    source.screens[0]!.artboard = { width: 100, height: 100 };
    source.screens[0]!.elements = [{
      id: "headline", type: "text", x: 10, y: 10, width: 80, height: 20,
      rotation: 0, opacity: 1, locked: false, visible: true,
      content: "Hello", fontFamily: "Inter", size: 10, weight: 400,
      lineHeight: 1.2, letterSpacing: 1, align: "left", color: "#FFFFFF",
      shadow: { color: "#000000", blur: 60, offsetX: 0, offsetY: 4, opacity: 0.5 },
    }];

    expect(() => resizeScreenArtboard(source, "hero", { width: 200, height: 200 }))
      .toThrow('Cannot scale text shadow blur above 100 for element "headline"');
  });

  it("resizes one store target output set without changing roots or sibling targets", () => {
    let withTargets = sampleProject();
    for (const rootId of ["hero", "details"]) {
      withTargets = ensureStoreTargetVariant(withTargets, rootId, {
        id: "6.5", width: 1284, height: 2778,
      }).project;
      withTargets = ensureStoreTargetVariant(withTargets, rootId, {
        id: "5.5", width: 1242, height: 2688,
      }).project;
    }
    const source = withTargets.screens.find((screen) =>
      screen.variantOf === "hero" && screen.storeTargetId === "6.5"
    )!;
    const originalRoots = withTargets.screens.filter((screen) => screen.storeTargetId === undefined);
    const originalSiblingTarget = withTargets.screens.filter((screen) => screen.storeTargetId === "5.5");

    const resized = resizeStoreOutputArtboards(withTargets, source.id, {
      width: 642,
      height: 1389,
    });

    const resizedTarget = resized.screens.filter((screen) => screen.storeTargetId === "6.5");
    expect(resizedTarget).toHaveLength(2);
    expect(resizedTarget.every((screen) =>
      screen.artboard.width === 642 && screen.artboard.height === 1389
    )).toBe(true);
    expect(resized.screens.filter((screen) => screen.storeTargetId === undefined))
      .toEqual(originalRoots);
    expect(resized.screens.filter((screen) => screen.storeTargetId === "5.5"))
      .toEqual(originalSiblingTarget);
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

  it("creates new watchOS output families with 3.5x custom masters", () => {
    const source = sampleProject();
    const result = ensureStoreOutputFamily(source, "hero", "apple", "watchos", {
      id: "ultra-3", width: 422, height: 514,
    });

    const watchRoots = result.project.screens.filter((screen) =>
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
    expect(source.screens.map((screen) => screen.artboard)).toEqual([
      { width: 1320, height: 2868 },
      { width: 1320, height: 2868 },
    ]);

    const variant = ensureStoreTargetVariant(result.project, watchRoots[0]!.id, {
      id: "series-11", width: 416, height: 496,
    }).variant;
    expect(variant).toMatchObject({
      variantOf: watchRoots[0]!.id,
      storeTargetId: "series-11",
      artboard: { width: 1456, height: 1736 },
    });
  });

  it("reuses an existing target output set size for newly added variants", () => {
    const family = ensureStoreOutputFamily(sampleProject(), "hero", "apple", "watchos", {
      id: "ultra-3", width: 422, height: 514,
    });
    const watchRoots = family.project.screens.filter((screen) =>
      screen.platform === "apple"
      && screen.device === "watchos"
      && screen.variantOf === undefined
    );
    const first = ensureStoreTargetVariant(family.project, watchRoots[0]!.id, {
      id: "series-11", width: 416, height: 496,
    });
    const resized = resizeStoreOutputArtboards(first.project, first.variant.id, {
      width: 832,
      height: 992,
    });

    const second = ensureStoreTargetVariant(resized, watchRoots[1]!.id, {
      id: "series-11", width: 416, height: 496,
    });

    expect(second.variant.artboard).toEqual({ width: 832, height: 992 });
  });

  it("derives watchOS masters from the supplied lead dimensions", () => {
    const result = ensureStoreOutputFamily(sampleProject(), "hero", "apple", "watchos", {
      id: "custom-watch-lead", width: 400, height: 500,
    });

    expect(result.firstScreen.artboard).toEqual({ width: 1400, height: 1750 });
  });

  it("rejects watchOS lead dimensions that cannot produce an integer 3.5x master", () => {
    const source = sampleProject();

    expect(() => ensureStoreOutputFamily(source, "hero", "apple", "watchos", {
      id: "fractional-watch-lead", width: 401, height: 501,
    })).toThrow(/derived artboard must use integer dimensions/);
    expect(source.screens).toHaveLength(2);
  });

  it("rejects watchOS variant dimensions that cannot produce an integer 3.5x artboard", () => {
    const family = ensureStoreOutputFamily(sampleProject(), "hero", "apple", "watchos", {
      id: "ultra-3", width: 422, height: 514,
    });
    const before = family.project;

    expect(() => ensureStoreTargetVariant(before, family.firstScreen.id, {
      id: "fractional-watch-target", width: 401, height: 501,
    })).toThrow(/derived artboard must use integer dimensions/);
    expect(before.screens).toHaveLength(4);
  });

  it("reopens an existing fixed watchOS family without resizing it", () => {
    const source = sampleProject();
    source.screens.push({
      ...structuredClone(source.screens[0]!),
      id: "existing-watch",
      platform: "apple",
      device: "watchos",
      artboard: { width: 422, height: 514 },
      elements: [],
    });

    const result = ensureStoreOutputFamily(source, "hero", "apple", "watchos", {
      id: "ultra-3", width: 422, height: 514,
    });

    expect(result.created).toBe(false);
    expect(result.project).toBe(source);
    expect(result.firstScreen.id).toBe("existing-watch");
    expect(result.firstScreen.artboard).toEqual({ width: 422, height: 514 });
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
