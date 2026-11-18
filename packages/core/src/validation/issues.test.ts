// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  createDeviceFrameElement,
  createImageElement,
  createScreenshotElement,
  createTextElement,
  parseProject,
  type Element,
} from "@screenshot-studio/core/model";
import { collectLayoutIssues } from "./issues.js";

function text(id: string, content: string, visible = true) {
  return { ...createTextElement({}), id, content, visible };
}

function screen(id: string, name: string, locale: string, elements: Element[] = []) {
  return {
    id,
    name,
    platform: "apple",
    device: "iphone",
    locale,
    artboard: { width: 1320, height: 2868 },
    background: { type: "solid", color: "#101827" },
    elements,
  };
}

const project = parseProject({
  meta: { name: "T", schemaVersion: 1 },
  fonts: [],
  preferredExportLayoutId: "default",
  layouts: [{
    id: "default",
    name: "Default",
    mode: "isolated",
    screens: [
      screen("hero", "Hero", "en", [
        text("long-title", "long"),
        text("short-title", "short"),
        text("hidden-title", "long", false),
        {
          id: "group",
          type: "group",
          x: 0,
          y: 0,
          width: 400,
          height: 240,
          children: [text("group-long", "long"), text("group-hidden", "long", false)],
        } as Element,
      ]),
      screen("details", "Details", "en"),
      screen("hero-de", "Hero", "de", [text("de-long", "long")]),
    ],
  }],
});

const overflowsWhenLong = (element: { content: string }) => element.content === "long";

describe("collectLayoutIssues", () => {
  it("lists blockers first, then visible overflowing text in screen order", () => {
    expect(collectLayoutIssues(project, "default", { textOverflows: overflowsWhenLong })).toEqual([
      {
        kind: "missing-locale-screen",
        id: "missing-locale-screen:de:details",
        level: "blocker",
        layoutId: "default",
        locale: "de",
        sourceLocale: "en",
        sourceScreenId: "details",
        allSizes: false,
      },
      expect.objectContaining({ kind: "text-overflow", level: "warning", screenId: "hero", elementId: "long-title" }),
      expect.objectContaining({ kind: "text-overflow", screenId: "hero", elementId: "group-long" }),
      expect.objectContaining({ kind: "text-overflow", screenId: "hero-de", elementId: "de-long" }),
    ]);
  });

  it("skips overflow until a measurer is supplied", () => {
    expect(collectLayoutIssues(project, "default").map((issue) => issue.kind))
      .toEqual(["missing-locale-screen"]);
  });
});

describe("missing-image issues", () => {
  const media = parseProject({
    meta: { name: "M", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [{
      id: "default",
      name: "Default",
      mode: "isolated",
      screens: [
        {
          ...screen("hero", "Hero", "en", [
            { ...createScreenshotElement({ assetUrl: "assets/gone.png" }), id: "shot" },
            { ...createImageElement({ assetUrl: "assets/here.png" }), id: "kept" },
            { ...createDeviceFrameElement({ assetUrl: "assets/gone.png" }), id: "frame" },
            { ...createDeviceFrameElement(), id: "empty-frame" },
            { ...createImageElement({ assetUrl: "assets/gone.png" }), id: "hidden-image", visible: false },
            {
              id: "hidden-group",
              type: "group",
              x: 0,
              y: 0,
              width: 300,
              height: 300,
              visible: false,
              children: [{ ...createImageElement({ assetUrl: "assets/gone.png" }), id: "grouped" }],
            } as Element,
          ]),
          background: { type: "image", assetUrl: "assets/gone-bg.png", fit: "cover", color: "#000000" },
        },
        screen("details", "Details", "en", [{ ...text("long-title", "long"), id: "details-title" }]),
      ],
    }],
  });
  const imageMissing = (assetUrl: string) => assetUrl.includes("gone");

  it("reports each visible usage as a blocker before overflow warnings", () => {
    expect(collectLayoutIssues(media, "default", { imageMissing, textOverflows: overflowsWhenLong })).toEqual([
      {
        kind: "missing-image",
        id: "missing-image:hero:background",
        level: "blocker",
        layoutId: "default",
        screenId: "hero",
        elementId: null,
        assetUrl: "assets/gone-bg.png",
      },
      expect.objectContaining({ kind: "missing-image", screenId: "hero", elementId: "shot", assetUrl: "assets/gone.png" }),
      expect.objectContaining({ kind: "missing-image", screenId: "hero", elementId: "frame", assetUrl: "assets/gone.png" }),
      expect.objectContaining({ kind: "text-overflow", screenId: "details", elementId: "details-title" }),
    ]);
  });

  it("skips missing images until the image cache is supplied", () => {
    expect(collectLayoutIssues(media, "default").map((issue) => issue.kind)).toEqual([]);
  });

  describe("unequal connected artboards", () => {
    const strip = (mode: "connected" | "isolated", second: { width: number; height: number }) => parseProject({
      meta: { name: "T", schemaVersion: 1 },
      fonts: [],
      preferredExportLayoutId: "default",
      layouts: [{
        id: "default",
        name: "Default",
        mode,
        screens: [
          screen("first", "First", "en"),
          { ...screen("second", "Second", "en"), artboard: second },
          { ...screen("other-locale", "Other", "de"), artboard: { width: 1000, height: 2000 } },
        ],
      }],
    });

    const unequal = (mode: "connected" | "isolated", second: { width: number; height: number }) =>
      collectLayoutIssues(strip(mode, second), "default").filter(({ kind }) => kind === "unequal-connected-artboard");

    it("warns on a screen whose artboard differs from its strip", () => {
      expect(unequal("connected", { width: 1320, height: 2778 })).toEqual([{
        kind: "unequal-connected-artboard",
        id: "unequal-connected-artboard:second",
        level: "warning",
        layoutId: "default",
        screenId: "second",
        elementId: null,
        stripArtboard: { width: 1320, height: 2868 },
      }]);
    });

    it("stays quiet on an equal strip, across exact groups, and in isolated layouts", () => {
      expect(unequal("connected", { width: 1320, height: 2868 })).toEqual([]);
      expect(unequal("isolated", { width: 1320, height: 2778 })).toEqual([]);
    });
  });
});

describe("native-placement issues", () => {
  const nativeShot = (overrides: Record<string, unknown> = {}) => ({
    ...createScreenshotElement({ assetUrl: "assets/shot.png" }),
    id: "shot",
    x: 100,
    y: 200,
    width: 1080,
    height: 2300,
    fit: "native",
    cornerRadius: 0,
    nativeInsets: { top: 80, right: 0, bottom: 20, left: 0 },
    ...overrides,
  }) as Element;
  const layoutWith = (elements: Element[]) => parseProject({
    meta: { name: "T", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [{ id: "default", name: "Default", mode: "isolated", screens: [screen("hero", "Hero", "en", elements)] }],
  });
  const checks = {
    imageSize: () => ({ width: 1080, height: 2400 }),
    exportScale: () => 1,
  };
  const reasons = (elements: Element[], extra = {}) => collectLayoutIssues(layoutWith(elements), "default", { ...checks, ...extra })
    .flatMap((issue) => issue.kind === "native-placement" ? issue.reasons : []);

  it("reports nothing for a 1:1 shot that matches its cropped source on whole pixels", () => {
    expect(reasons([nativeShot()])).toEqual([]);
  });

  it("reports every reason the export check would reject", () => {
    expect(reasons([
      nativeShot({ x: 100.5, rotation: 3, blur: 4, width: 1000 }),
      text("over", "short"),
    ], { exportScale: () => 2 })).toEqual([
      "export-scale", "fractional-position", "transform", "effect", "size-mismatch", "covered",
    ]);
  });

  it("checks the group a shot sits in and the artboard edge", () => {
    const group = {
      id: "group", type: "group", x: 300, y: 0, width: 1080, height: 2300, opacity: 0.5,
      children: [nativeShot({ x: 0, y: 0 })],
    } as Element;
    expect(reasons([group])).toEqual(["transform", "off-artboard"]);
  });

  it("flags insets that remove the whole image", () => {
    expect(reasons([nativeShot({ nativeInsets: { top: 2400, right: 0, bottom: 0, left: 0 } })]))
      .toEqual(["insets-exceed-image"]);
  });
});
