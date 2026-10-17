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
});
