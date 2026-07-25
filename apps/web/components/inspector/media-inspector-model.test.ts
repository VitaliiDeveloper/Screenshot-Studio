// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { ImageElement, ScreenshotElement } from "@screenshot-studio/core/model";
import {
  adjustCropZoom,
  cropFromPointer,
  directCropPatch,
  mediaInspectorModel,
  nudgeCrop,
} from "./media-inspector-model";

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

  it("maps and clamps pointer coordinates to normalized focal values", () => {
    expect(cropFromPointer({ x: 25, y: 75 }, { width: 100, height: 100 }, 2))
      .toEqual({ x: 0.25, y: 0.75, zoom: 2 });
    expect(cropFromPointer({ x: -10, y: 140 }, { width: 100, height: 100 }, 1))
      .toEqual({ x: 0, y: 1, zoom: 1 });
  });

  it("nudges the focal point with clamped keyboard steps", () => {
    expect(nudgeCrop({ x: 0.5, y: 0.5, zoom: 1 }, "ArrowRight", false))
      .toEqual({ x: 0.51, y: 0.5, zoom: 1 });
    expect(nudgeCrop({ x: 0.5, y: 0.5, zoom: 1 }, "ArrowUp", true))
      .toEqual({ x: 0.5, y: 0.4, zoom: 1 });
  });

  it("keeps zoom inside the persisted 1x to 4x contract", () => {
    expect(adjustCropZoom({ x: 0.5, y: 0.5, zoom: 1 }, -0.1).zoom).toBe(1);
    expect(adjustCropZoom({ x: 0.5, y: 0.5, zoom: 3.95 }, 0.1).zoom).toBe(4);
  });

  it("refuses direct crop patches across an effective lock boundary", () => {
    const crop = { x: 0.25, y: 0.75, zoom: 2 };
    expect(directCropPatch(true, crop)).toBeNull();
    expect(directCropPatch(false, crop)).toEqual(crop);
  });
});
