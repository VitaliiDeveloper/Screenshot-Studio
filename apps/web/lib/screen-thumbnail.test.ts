// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { ImageCache } from "@screenshot-studio/core/assets";
import type { CanvasMode, DesignLayout, Project } from "@screenshot-studio/core/model";
import { screenThumbnailInputsEqual, screenThumbnailPixelRatio } from "./screen-thumbnail.js";

function project(mode: CanvasMode = "connected"): Project {
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
    meta: { name: "Thumbnails", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "primary",
    layouts: [{ id: "primary", name: "Primary", mode, screens: [
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
    ] }],
  };
}

function updateLayout(project: Project, update: (layout: DesignLayout) => DesignLayout): Project {
  return { ...project, layouts: [update(project.layouts[0]!)] };
}

const images: ImageCache = new Map();

describe("screen thumbnail memoization", () => {
  it("rasterizes contain previews for their rendered size and screen density", () => {
    expect(screenThumbnailPixelRatio({
      stageWidth: 1320,
      stageHeight: 2868,
      viewportWidth: 520,
      viewportHeight: 416,
      devicePixelRatio: 2,
      fit: "contain",
    })).toBeCloseTo((416 / 2868) * 2);
    expect(screenThumbnailPixelRatio({
      stageWidth: 1920,
      stageHeight: 1080,
      viewportWidth: 520,
      viewportHeight: 416,
      devicePixelRatio: 2,
      fit: "contain",
    })).toBeCloseTo((520 / 1920) * 2);
  });

  it("bounds thumbnail density for hidden or oversized viewports", () => {
    expect(screenThumbnailPixelRatio({
      stageWidth: 1320,
      stageHeight: 2868,
      viewportWidth: 0,
      viewportHeight: 0,
      devicePixelRatio: 2,
      fit: "contain",
    })).toBe(0.12);
    expect(screenThumbnailPixelRatio({
      stageWidth: 100,
      stageHeight: 100,
      viewportWidth: 1000,
      viewportHeight: 1000,
      devicePixelRatio: 3,
      fit: "cover",
    })).toBe(1);
  });

  it("rerenders when the requested image fit changes", () => {
    const current = project();
    expect(screenThumbnailInputsEqual(
      { project: current, layoutId: "primary", screenId: "first", images, fit: "cover" },
      { project: current, layoutId: "primary", screenId: "first", images, fit: "contain" },
    )).toBe(false);
  });

  it("invalidates a connected crop when a neighbouring owner changes", () => {
    const previous = project();
    const next = updateLayout(previous, (layout) => ({
      ...layout,
      screens: layout.screens.map((screen) => screen.id === "second"
        ? { ...screen, background: { type: "solid" as const, color: "#333333" } }
        : screen),
    }));
    expect(screenThumbnailInputsEqual(
      { project: previous, layoutId: "primary", screenId: "first", images },
      { project: next, layoutId: "primary", screenId: "first", images },
    )).toBe(false);
  });

  it("keeps an unrelated connected group memoized", () => {
    const previous = project();
    const next = updateLayout(previous, (layout) => ({
      ...layout,
      screens: layout.screens.map((screen) => screen.id === "unrelated"
        ? { ...screen, name: "Changed" }
        : screen),
    }));
    expect(screenThumbnailInputsEqual(
      { project: previous, layoutId: "primary", screenId: "first", images },
      { project: next, layoutId: "primary", screenId: "first", images },
    )).toBe(true);
  });

  it("invalidates connected group order but keeps isolated neighbours independent", () => {
    const previous = project();
    const reordered = updateLayout(previous, (layout) => ({
      ...layout,
      screens: [layout.screens[1]!, layout.screens[0]!, layout.screens[2]!],
    }));
    expect(screenThumbnailInputsEqual(
      { project: previous, layoutId: "primary", screenId: "first", images },
      { project: reordered, layoutId: "primary", screenId: "first", images },
    )).toBe(false);

    const isolated = project("isolated");
    const changedNeighbour = updateLayout(isolated, (layout) => ({
      ...layout,
      screens: layout.screens.map((screen) => screen.id === "second" ? { ...screen, name: "Changed" } : screen),
    }));
    expect(screenThumbnailInputsEqual(
      { project: isolated, layoutId: "primary", screenId: "first", images },
      { project: changedNeighbour, layoutId: "primary", screenId: "first", images },
    )).toBe(true);
  });
});
