import { describe, expect, it } from "vitest";
import type { Project } from "./schema.js";
import {
  addScreenToProject,
  cloneScreenWithFreshIds,
  findUnresolvedFonts,
  parseScreenPlacement,
  recomputeManifests,
  removeScreenFromProject,
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

  it("finds each text font identity absent from project assets once", () => {
    const project = sampleProject();
    project.screens[0]!.elements = [
      {
        id: "title", type: "text", x: 0, y: 0, width: 100, height: 100,
        content: "Title", fontFamily: "Inter", weight: 700, size: 24, color: "#FFFFFF",
      },
      {
        id: "body", type: "text", x: 0, y: 100, width: 100, height: 100,
        content: "Body", fontFamily: "Inter", weight: 400, size: 24, color: "#FFFFFF",
      },
      {
        id: "title-again", type: "text", x: 0, y: 200, width: 100, height: 100,
        content: "Again", fontFamily: "Inter", weight: 700, size: 24, color: "#FFFFFF",
      },
    ];
    project.fonts = [{ family: "Inter", source: "uploaded", path: "assets/fonts/inter-400.ttf", weight: 400 }];

    expect(findUnresolvedFonts(project)).toEqual([{ family: "Inter", weight: 700 }]);
  });
});
