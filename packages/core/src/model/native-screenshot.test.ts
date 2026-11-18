// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { applyElementPatch } from "./element-patch.js";
import { scaleLeafElement } from "./element-scale.js";
import { createScreenshotElement } from "./factories.js";
import { nativeSourceRect } from "./native-screenshot.js";
import type { ScreenshotElement } from "./schema.js";

const shot = (): ScreenshotElement => ({
  ...createScreenshotElement({ assetUrl: "assets/shot.png" }),
  id: "shot",
  x: 100,
  y: 200,
  width: 1080,
  height: 2300,
  fit: "native",
  cornerRadius: 0,
  nativeInsets: { top: 80, right: 0, bottom: 20, left: 0 },
});

describe("native screenshots", () => {
  it("draws the inset source rect, clipped to the box and never larger than the source", () => {
    expect(nativeSourceRect({ width: 1080, height: 2400 }, { width: 1080, height: 2300 }, shot().nativeInsets))
      .toEqual({ x: 0, y: 80, width: 1080, height: 2300 });
    expect(nativeSourceRect({ width: 1080, height: 2400 }, { width: 2000, height: 100.7 }))
      .toEqual({ x: 0, y: 0, width: 1080, height: 100 });
  });

  it("keeps its pixel size when a store size scales the layout and moves its centre", () => {
    const scaled = scaleLeafElement(shot(), 0.5);
    expect(scaled).toMatchObject({ width: 1080, height: 2300, nativeInsets: shot().nativeInsets });
    expect(scaled.x).toBe(Math.round((100 + 540) * 0.5 - 540));
    expect(scaled.y).toBe(Math.round((200 + 1150) * 0.5 - 1150));
  });

  it("drops its insets when it leaves 1:1", () => {
    const element = shot();
    applyElementPatch(element, { fit: "cover" });
    expect(element.fit).toBe("cover");
    expect(element.nativeInsets).toBeUndefined();
  });
});
