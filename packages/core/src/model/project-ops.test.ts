import { describe, expect, it } from "vitest";
import type { Project } from "./schema.js";
import {
  addScreenToProject,
  cloneLocaleSet,
  cloneScreenWithFreshIds,
  findUnresolvedFonts,
  assertProjectFontsResolved,
  formatUnresolvedFontsError,
  parseScreenPlacement,
  recomputeManifests,
  removeScreenFromProject,
  removeLocaleSet,
  reorderScreenInProject,
  slugify,
  uniqueId,
} from "./project-ops.js";

function sampleProject(): Project {
  return {
    meta: { name: "T", schemaVersion: 1 },
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
    expect(project.locales).toEqual(["en", "uk"]);
    expect(project.screens.at(-1)).toMatchObject({
      id: "ipad-hero",
      platform: "apple",
      device: "ipad",
      locale: "uk",
      artboard: { width: 2048, height: 2732 },
    });
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

  it("cloneLocaleSet appends an independent target set in source order", () => {
    const source = sampleProject();
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

    const result = cloneLocaleSet(source, "en", "ar");
    const targets = result.screens.filter((screen) => screen.locale === "ar");

    expect(result.locales).toEqual(["en", "ar"]);
    expect(result.screens.slice(-2)).toEqual(targets);
    expect(targets.map((screen) => screen.name)).toEqual(["Hero", "Details"]);
    expect(targets.map((screen) => screen.id)).not.toEqual(["hero", "details"]);
    expect(targets[0]!.elements[0]!.id).not.toBe("hero-shot");
    expect(targets[0]!.elements[0]).toMatchObject({
      type: "screenshot",
      assetUrl: "assets/shared/hero.png",
      x: 10,
      y: 20,
    });
    expect(source.locales).toEqual(["en"]);
    expect(source.screens).toHaveLength(2);
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
