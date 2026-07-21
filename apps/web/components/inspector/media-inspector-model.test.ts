// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { ImageElement, ScreenshotElement } from "@screenshot-studio/core/model";
import { mediaInspectorModel } from "./media-inspector-model";

const base = {
  x: 0,
  y: 0,
  width: 100,
  height: 200,
  rotation: 0,
  opacity: 1,
  locked: false,
  visible: true,
  assetUrl: "assets/example.png",
  cornerRadius: 12,
};

describe("shared media inspector model", () => {
  it.each([
    { ...base, id: "shot", type: "screenshot", fit: "cover" } as ScreenshotElement,
    { ...base, id: "decor", type: "image", fit: "cover" } as ImageElement,
  ])("uses the same default cover crop for $type", (element) => {
    expect(mediaInspectorModel(element)).toEqual({
      crop: { x: 0.5, y: 0.5, zoom: 1 },
      showCrop: true,
      canResetCrop: false,
    });
  });

  it("preserves persisted cover crop and exposes reset", () => {
    const element = {
      ...base,
      id: "decor",
      type: "image",
      fit: "cover",
      crop: { x: 0.2, y: 0.8, zoom: 2 },
    } as ImageElement;
    expect(mediaInspectorModel(element)).toEqual({
      crop: element.crop,
      showCrop: true,
      canResetCrop: true,
    });
  });

  it("hides crop controls for contain media", () => {
    const element = { ...base, id: "shot", type: "screenshot", fit: "contain" } as ScreenshotElement;
    expect(mediaInspectorModel(element)).toEqual({
      crop: { x: 0.5, y: 0.5, zoom: 1 },
      showCrop: false,
      canResetCrop: false,
    });
  });
});
