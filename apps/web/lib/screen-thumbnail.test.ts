// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { ImageCache } from "@screenshot-studio/core/assets";
import type { Project } from "@screenshot-studio/core/model";
import { screenThumbnailInputsEqual } from "./screen-thumbnail.js";

function project(mode: Project["mode"] = "connected"): Project {
  const shape = (id: string) => ({
    id,
    type: "shape" as const,
    x: 100,
    y: 100,
    width: 200,
    height: 200,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    kind: "rect" as const,
    fill: "#FF0000",
    radius: 0,
  });
  return {
    meta: { name: "Thumbnails", schemaVersion: 4 },
    mode,
    platforms: ["apple", "android"],
    locales: ["en"],
    fonts: [],
    screens: [
      {
        id: "first", name: "First", platform: "apple", device: "iphone", locale: "en", direction: "ltr",
        artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#000000" },
        elements: [shape("first-shape")],
      },
      {
        id: "second", name: "Second", platform: "apple", device: "iphone", locale: "en", direction: "ltr",
        artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#111111" },
        elements: [shape("second-shape")],
      },
      {
        id: "unrelated", name: "Unrelated", platform: "android", device: "phone", locale: "en", direction: "ltr",
        artboard: { width: 540, height: 960 }, background: { type: "solid", color: "#222222" }, elements: [],
      },
    ],
  };
}

const images: ImageCache = new Map();

describe("screen thumbnail memoization", () => {
  it("invalidates a connected crop when a neighbouring owner changes", () => {
    const previous = project();
    const next = {
      ...previous,
      screens: previous.screens.map((screen) => screen.id === "second"
        ? { ...screen, background: { type: "solid" as const, color: "#333333" } }
        : screen),
    };
    expect(screenThumbnailInputsEqual(
      { project: previous, screenId: "first", images },
      { project: next, screenId: "first", images },
    )).toBe(false);
  });

  it("keeps an unrelated connected group memoized", () => {
    const previous = project();
    const next = {
      ...previous,
      screens: previous.screens.map((screen) => screen.id === "unrelated"
        ? { ...screen, name: "Changed" }
        : screen),
    };
    expect(screenThumbnailInputsEqual(
      { project: previous, screenId: "first", images },
      { project: next, screenId: "first", images },
    )).toBe(true);
  });

  it("invalidates connected group order but keeps isolated neighbours independent", () => {
    const previous = project();
    const reordered = { ...previous, screens: [previous.screens[1]!, previous.screens[0]!, previous.screens[2]!] };
    expect(screenThumbnailInputsEqual(
      { project: previous, screenId: "first", images },
      { project: reordered, screenId: "first", images },
    )).toBe(false);

    const isolated = project("isolated");
    const changedNeighbour = {
      ...isolated,
      screens: isolated.screens.map((screen) => screen.id === "second" ? { ...screen, name: "Changed" } : screen),
    };
    expect(screenThumbnailInputsEqual(
      { project: isolated, screenId: "first", images },
      { project: changedNeighbour, screenId: "first", images },
    )).toBe(true);
  });
});
