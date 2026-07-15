// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Project } from "./schema.js";
import { countProjectFontUsage } from "./project-font-usage.js";

const project: Project = {
  meta: { name: "Font usage", schemaVersion: 1 },
  mode: "isolated",
  platforms: ["apple"],
  locales: ["en"],
  fonts: [],
  screens: [{
    id: "hero",
    name: "Hero",
    platform: "apple",
    device: "iphone",
    locale: "en",
    direction: "ltr",
    artboard: { width: 660, height: 1434 },
    background: { type: "solid", color: "#111111" },
    elements: [{
      id: "top-level",
      type: "text",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      rotation: 0,
      opacity: 1,
      locked: false,
      visible: true,
      content: "Top level",
      fontFamily: "Inter",
      size: 24,
      weight: 400,
      lineHeight: 1.2,
      letterSpacing: 0,
      align: "left",
      color: "#ffffff",
    }, {
      id: "group",
      type: "group",
      x: 0,
      y: 100,
      width: 300,
      height: 200,
      rotation: 0,
      opacity: 1,
      locked: false,
      visible: true,
      children: [{
        id: "nested-match",
        type: "text",
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        rotation: 0,
        opacity: 1,
        locked: false,
        visible: true,
        content: "Nested match",
        fontFamily: "Inter",
        size: 24,
        weight: 400,
        lineHeight: 1.2,
        letterSpacing: 0,
        align: "left",
        color: "#ffffff",
      }, {
        id: "nested-other-weight",
        type: "text",
        x: 120,
        y: 0,
        width: 100,
        height: 50,
        rotation: 0,
        opacity: 1,
        locked: false,
        visible: true,
        content: "Nested other",
        fontFamily: "Inter",
        size: 24,
        weight: 700,
        lineHeight: 1.2,
        letterSpacing: 0,
        align: "left",
        color: "#ffffff",
      }, {
        id: "nested-shape",
        type: "shape",
        x: 0,
        y: 80,
        width: 100,
        height: 20,
        rotation: 0,
        opacity: 1,
        locked: false,
        visible: true,
        kind: "rect",
        fill: "#ffffff",
        radius: 0,
      }],
    }],
  }],
};

describe("countProjectFontUsage", () => {
  it("counts matching top-level and grouped text leaves by exact identity", () => {
    expect(countProjectFontUsage(project, { family: "Inter", weight: 400 })).toBe(2);
    expect(countProjectFontUsage(project, { family: "Inter", weight: 700 })).toBe(1);
  });

  it("ignores other text identities and non-text leaves", () => {
    expect(countProjectFontUsage(project, { family: "Other", weight: 400 })).toBe(0);
    expect(countProjectFontUsage(project, { family: "Inter", weight: 500 })).toBe(0);
  });
});
