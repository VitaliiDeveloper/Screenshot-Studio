// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { nativeModePatch } from "./MediaPresentationFields.js";
import { nativeInsetsPatch } from "./NativeScreenshotFields.js";

describe("1:1 screenshot inspector patches", () => {
  it("entering 1:1 sizes the box to the source and clears pixel-altering fields", () => {
    expect(nativeModePatch({ x: 10.6, y: 20.2 }, { width: 1080, height: 2400 })).toEqual({
      fit: "native",
      x: 11,
      y: 20,
      rotation: 0,
      opacity: 1,
      cornerRadius: 0,
      blur: null,
      crop: null,
      nativeInsets: null,
      width: 1080,
      height: 2400,
    });
    expect(nativeModePatch({ x: 0, y: 0 }, null)).not.toHaveProperty("width");
  });

  it("an inset edit resizes the box to the cropped source and clears empty insets", () => {
    expect(nativeInsetsPatch({ top: 80, right: 0, bottom: 20, left: 0 }, { width: 1080, height: 2400 }))
      .toEqual({ nativeInsets: { top: 80, right: 0, bottom: 20, left: 0 }, width: 1080, height: 2300 });
    expect(nativeInsetsPatch({ top: 0, right: 0, bottom: 0, left: 0 }, { width: 1080, height: 2400 }))
      .toEqual({ nativeInsets: null, width: 1080, height: 2400 });
    expect(nativeInsetsPatch({ top: 2400, right: 0, bottom: 0, left: 0 }, { width: 1080, height: 2400 }))
      .toEqual({ nativeInsets: { top: 2400, right: 0, bottom: 0, left: 0 } });
  });
});
