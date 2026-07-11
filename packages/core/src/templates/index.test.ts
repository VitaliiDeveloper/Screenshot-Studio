// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Project } from "../model/schema.js";
import { createScreenFromTemplate, ScreenTemplate, type ScreenTemplate as Template } from "./index.js";

function project(): Project {
  return {
    meta: { name: "Templates", schemaVersion: 7 }, mode: "connected", platforms: ["apple"], locales: ["en"],
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
    expect(result.project.mode).toBe("connected");
    expect(result.project.platforms).toEqual(["apple", "android"]);
    expect(result.project.locales).toEqual(["en", "uk"]);
  });

  it("preserves structured backgrounds instead of flattening them", () => {
    const gradient: Template = {
      ...template,
      background: { type: "linear-gradient", from: "#112233", to: "#AABBCC", angle: 35 },
    };
    expect(createScreenFromTemplate(project(), gradient, "en").screen.background).toEqual(
      gradient.background,
    );
  });

  it("bakes LTR template geometry for an existing RTL locale", () => {
    const rtlProject = project();
    rtlProject.screens[0]!.direction = "rtl";
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

    const result = createScreenFromTemplate(rtlProject, rtlTemplate, "en");

    expect(result.screen.direction).toBe("rtl");
    expect(result.screen.elements[0]).toMatchObject({ x: 680, align: "right" });
    expect(rtlTemplate.elements[0]).toMatchObject({ x: 100, align: "left" });
  });

  it("uses a unique screen id on repeated creation", () => {
    const first = createScreenFromTemplate(project(), template, "en").project;
    expect(createScreenFromTemplate(first, template, "en").screen.id).toBe("feature-card-2");
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

    const result = createScreenFromTemplate(project(), grouped, "en");
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
    expect(() => createScreenFromTemplate(project(), missing, "en")).toThrow(/unregistered font/);
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
    const result = createScreenFromTemplate(project(), withImage, "en");
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
    const result = createScreenFromTemplate(project(), withIcon, "en");
    expect(result.screen.elements[0]).toMatchObject({
      type: "icon", icon: "check", color: "#22C55E", strokeWidth: 4,
    });
    expect(result.screen.elements[0]!.id).not.toBe("icon");
  });

  it("rejects template text with an unregistered font", () => {
    const missing = { ...template, elements: [{ ...template.elements[0]!, fontFamily: "Missing" }] } as Template;
    expect(() => createScreenFromTemplate(project(), missing, "en")).toThrow(/unregistered font/);
  });
});
