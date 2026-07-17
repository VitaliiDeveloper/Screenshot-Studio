// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Project } from "../model/schema.js";
import { applyTheme, Theme } from "./index.js";

function project(): Project {
  return {
    meta: { name: "Theme", schemaVersion: 1 },
    fonts: [
      { family: "Inter", weight: 700, source: "uploaded", path: "assets/fonts/inter-700.ttf" },
    ],
    preferredExportLayoutId: "default",
    layouts: [{
      id: "default", name: "Default", mode: "connected",
      screens: [{
        id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en", direction: "ltr",
        artboard: { width: 1320, height: 2868 },
        background: { type: "solid", color: "#000000" },
        elements: [
          { id: "title", type: "text", role: "heading", x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, locked: false, visible: true, content: "Title", fontFamily: "Old", weight: 400, size: 40, lineHeight: 1.2, letterSpacing: 0, align: "left", color: "#FFFFFF" },
          { id: "accent", type: "shape", role: "accent", x: 0, y: 100, width: 100, height: 20, rotation: 0, opacity: 1, locked: false, visible: true, kind: "rect", fill: "#FFFFFF", radius: 0 },
          { id: "custom", type: "shape", x: 0, y: 120, width: 100, height: 20, rotation: 0, opacity: 1, locked: false, visible: true, kind: "rect", fill: "#123456", radius: 0 },
        ],
      }],
    }],
  };
}

const theme: Theme = {
  id: "midnight",
  name: "Midnight",
  colors: { heading: "#F8FAFC", body: "#CBD5E1", accent: "#38BDF8", surface: "#0F172A" },
  fonts: { heading: { family: "Inter", weight: 700 } },
};

describe("Theme", () => {
  it("strictly validates role tokens", () => {
    expect(Theme.parse(theme)).toEqual(theme);
    expect(() => Theme.parse({ ...theme, colors: { ...theme.colors, extra: "#fff" } })).toThrow();
  });
});

describe("applyTheme", () => {
  it("bakes role colors and fonts while preserving opt-out elements", () => {
    const next = applyTheme(project(), "default", theme);
    expect(next.layouts[0]!.mode).toBe("connected");
    expect(next.layouts[0]!.screens[0]!.elements[0]).toMatchObject({ role: "heading", color: "#F8FAFC", fontFamily: "Inter", weight: 700 });
    expect(next.layouts[0]!.screens[0]!.elements[1]).toMatchObject({ role: "accent", fill: "#38BDF8" });
    expect(next.layouts[0]!.screens[0]!.elements[2]).toEqual(project().layouts[0]!.screens[0]!.elements[2]);
  });

  it("can reapply another theme because roles persist", () => {
    const first = applyTheme(project(), "default", theme);
    const next = applyTheme(first, "default", { ...theme, id: "sunrise", name: "Sunrise", colors: { ...theme.colors, heading: "#111111" } });
    expect(next.layouts[0]!.screens[0]!.elements[0]).toMatchObject({ role: "heading", color: "#111111" });
  });

  it("bakes roles into grouped leaves without changing group transforms", () => {
    const grouped = project();
    const title = grouped.layouts[0]!.screens[0]!.elements[0]!;
    const accent = grouped.layouts[0]!.screens[0]!.elements[1]!;
    if (title.type !== "text" || accent.type !== "shape") throw new Error("expected leaf fixtures");
    grouped.layouts[0]!.screens[0]!.elements = [{
      id: "group", type: "group", x: 120, y: 80, width: 400, height: 200,
      rotation: 12, opacity: 0.8, locked: false, visible: true,
      children: [
        { ...title, id: "group-title", x: 0, y: 0 },
        { ...accent, id: "group-accent", x: 0, y: 120 },
      ],
    }];

    const next = applyTheme(grouped, "default", theme);
    const result = next.layouts[0]!.screens[0]!.elements[0]!;
    expect(result).toMatchObject({ type: "group", x: 120, rotation: 12, opacity: 0.8 });
    if (result.type !== "group") throw new Error("expected group");
    expect(result.children[0]).toMatchObject({ color: "#F8FAFC", fontFamily: "Inter", weight: 700 });
    expect(result.children[1]).toMatchObject({ fill: "#38BDF8" });
  });

  it("preserves decorative image literals while applying a theme", () => {
    const source = project();
    source.layouts[0]!.screens[0]!.elements.push({
      id: "decor", type: "image", x: 20, y: 30, width: 200, height: 100,
      rotation: 5, opacity: 0.8, locked: false, visible: true,
      assetUrl: "assets/decor.png", fit: "contain", cornerRadius: 12,
    });
    const themed = applyTheme(source, "default", theme);
    expect(themed.layouts[0]!.screens[0]!.elements.at(-1)).toEqual(source.layouts[0]!.screens[0]!.elements.at(-1));
  });

  it("preserves editable icon literals while applying a theme", () => {
    const source = project();
    source.layouts[0]!.screens[0]!.elements.push({
      id: "icon", type: "icon", x: 20, y: 30, width: 100, height: 100,
      rotation: 0, opacity: 1, locked: false, visible: true,
      icon: "sparkles", color: "#FFCC00", strokeWidth: 3,
    });
    const themed = applyTheme(source, "default", theme);
    expect(themed.layouts[0]!.screens[0]!.elements.at(-1)).toEqual(source.layouts[0]!.screens[0]!.elements.at(-1));
  });

  it("rejects a theme font that the project has not registered", () => {
    expect(() => applyTheme(project(), "default", { ...theme, fonts: { heading: { family: "Missing", weight: 400 } } }))
      .toThrow(/unregistered font/);
  });

  it("rejects an unregistered theme font even when no text uses that role", () => {
    expect(() => applyTheme(project(), "default", { ...theme, fonts: { body: { family: "Missing", weight: 400 } } }))
      .toThrow(/unregistered font/);
  });
});
