// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
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
  removeLocaleSet,
  reorderScreenInProject,
  setLocaleDirection,
  slugify,
  uniqueId,
} from "./project-ops.js";
import { sampleProject } from "./project-ops-test-fixtures.js";

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
      background: { type: "solid", color: "#FFFFFF" },
    });
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

  it("accepts renderer-owned fonts without weakening missing custom-font checks", () => {
    const source = sampleProject();
    source.layouts[0]!.screens[0]!.elements = [{
      id: "built-in", type: "text", x: 0, y: 0, width: 200, height: 80,
      rotation: 0, opacity: 1, locked: false, visible: true,
      content: "Ready", fontFamily: "Screenshot Studio Sans", size: 30, weight: 400,
      lineHeight: 1.2, letterSpacing: 0, align: "left", color: "#FFFFFF",
    }];

    expect(findUnresolvedFonts(source)).toEqual([]);
    expect(() => assertProjectFontsResolved(source)).not.toThrow();
    const element = source.layouts[0]!.screens[0]!.elements[0]!;
    if (element.type !== "text") throw new Error("expected text element");
    element.fontFamily = "Missing Custom Font";
    expect(findUnresolvedFonts(source)).toEqual([{ family: "Missing Custom Font", weight: 400 }]);
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
