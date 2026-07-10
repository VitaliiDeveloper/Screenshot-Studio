// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Project } from "../model/schema.js";
import { applyTheme, Theme } from "./index.js";

function project(): Project {
  return {
    meta: { name: "Theme", schemaVersion: 2 },
    mode: "connected",
    platforms: ["apple"],
    locales: ["en"],
    fonts: [
      { family: "Inter", weight: 700, source: "uploaded", path: "assets/fonts/inter-700.ttf" },
    ],
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
    const next = applyTheme(project(), theme);
    expect(next.mode).toBe("connected");
    expect(next.screens[0]!.elements[0]).toMatchObject({ role: "heading", color: "#F8FAFC", fontFamily: "Inter", weight: 700 });
    expect(next.screens[0]!.elements[1]).toMatchObject({ role: "accent", fill: "#38BDF8" });
    expect(next.screens[0]!.elements[2]).toEqual(project().screens[0]!.elements[2]);
  });

  it("can reapply another theme because roles persist", () => {
    const first = applyTheme(project(), theme);
    const next = applyTheme(first, { ...theme, id: "sunrise", name: "Sunrise", colors: { ...theme.colors, heading: "#111111" } });
    expect(next.screens[0]!.elements[0]).toMatchObject({ role: "heading", color: "#111111" });
  });

  it("rejects a theme font that the project has not registered", () => {
    expect(() => applyTheme(project(), { ...theme, fonts: { heading: { family: "Missing", weight: 400 } } }))
      .toThrow(/unregistered font/);
  });

  it("rejects an unregistered theme font even when no text uses that role", () => {
    expect(() => applyTheme(project(), { ...theme, fonts: { body: { family: "Missing", weight: 400 } } }))
      .toThrow(/unregistered font/);
  });
});
