import { describe, expect, it } from "vitest";
import type { Project } from "../model/schema.js";
import { createScreenFromTemplate, ScreenTemplate, type ScreenTemplate as Template } from "./index.js";

function project(): Project {
  return {
    meta: { name: "Templates", schemaVersion: 1 }, platforms: ["apple"], locales: ["en"],
    fonts: [{ family: "Inter", source: "uploaded", path: "assets/fonts/inter-700.ttf", weight: 700 }],
    screens: [{ id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en", direction: "ltr", artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#111111" }, elements: [] }],
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

describe("ScreenTemplate", () => {
  it("strictly validates platform/device and fields", () => {
    expect(ScreenTemplate.parse(template).id).toBe("feature-card");
    expect(() => ScreenTemplate.parse({ ...template, device: "ipad" })).toThrow();
    expect(() => ScreenTemplate.parse({ ...template, unexpected: true })).toThrow();
  });
});

describe("createScreenFromTemplate", () => {
  it("appends a fresh-id screen, injects locale, and recomputes manifests", () => {
    const result = createScreenFromTemplate(project(), template, "uk");
    expect(result.screen).toMatchObject({ platform: "android", device: "phone", locale: "uk", name: "Feature card" });
    expect(result.screen.id).toBe("feature-card");
    expect(result.screen.elements.map((element) => element.id)).not.toEqual(["title", "accent"]);
    expect(new Set(result.screen.elements.map((element) => element.id)).size).toBe(2);
    expect(result.project.platforms).toEqual(["apple", "android"]);
    expect(result.project.locales).toEqual(["en", "uk"]);
  });

  it("uses a unique screen id on repeated creation", () => {
    const first = createScreenFromTemplate(project(), template, "en").project;
    expect(createScreenFromTemplate(first, template, "en").screen.id).toBe("feature-card-2");
  });

  it("rejects template text with an unregistered font", () => {
    const missing = { ...template, elements: [{ ...template.elements[0]!, fontFamily: "Missing" }] } as Template;
    expect(() => createScreenFromTemplate(project(), missing, "en")).toThrow(/unregistered font/);
  });
});
