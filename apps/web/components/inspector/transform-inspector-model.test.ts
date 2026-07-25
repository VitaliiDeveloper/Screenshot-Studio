// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  aspectRatioLockForced,
  defaultAspectRatioLocked,
  directTransformPatch,
  linkedSizePatch,
  positionFromMiniPointer,
  rotationFromPointer,
} from "./transform-inspector-model.js";

describe("transform inspector model", () => {
  it("preserves the current ratio when width is edited under lock", () => {
    expect(linkedSizePatch({ width: 968, height: 1640 }, "width", 484, true))
      .toEqual({ width: 484, height: 820 });
  });

  it("changes only the requested axis when ratio lock is off", () => {
    expect(linkedSizePatch({ width: 968, height: 1640 }, "height", 1000, false))
      .toEqual({ height: 1000 });
  });

  it("maps the mini-artboard pointer to the element center in artboard coordinates", () => {
    expect(positionFromMiniPointer({
      pointer: { x: 100, y: 150 },
      preview: { width: 200, height: 300 },
      artboard: { width: 1000, height: 2000 },
      element: { width: 200, height: 400 },
    })).toEqual({ x: 400, y: 800 });
  });

  it("clamps pointer coordinates to the mini-artboard before mapping", () => {
    expect(positionFromMiniPointer({
      pointer: { x: -20, y: 500 },
      preview: { width: 200, height: 300 },
      artboard: { width: 1000, height: 2000 },
      element: { width: 200, height: 400 },
    })).toEqual({ x: -100, y: 1800 });
  });

  it("returns a top-origin clockwise rotation", () => {
    expect(rotationFromPointer({ x: 50, y: 0 }, { x: 50, y: 50 })).toBe(0);
    expect(rotationFromPointer({ x: 100, y: 50 }, { x: 50, y: 50 })).toBe(90);
    expect(rotationFromPointer({ x: 0, y: 50 }, { x: 50, y: 50 })).toBe(270);
  });

  it("defaults ratio lock by element semantics without persisting it", () => {
    expect(defaultAspectRatioLocked("screenshot")).toBe(true);
    expect(defaultAspectRatioLocked("image")).toBe(true);
    expect(defaultAspectRatioLocked("group")).toBe(true);
    expect(defaultAspectRatioLocked("device-frame")).toBe(true);
    expect(defaultAspectRatioLocked("text")).toBe(false);
    expect(defaultAspectRatioLocked("shape")).toBe(false);
  });

  it("forces ratio lock only for elements whose renderer geometry requires it", () => {
    expect(aspectRatioLockForced("group")).toBe(true);
    expect(aspectRatioLockForced("device-frame")).toBe(true);
    expect(aspectRatioLockForced("screenshot")).toBe(false);
  });

  it("refuses direct transform patches for locked elements", () => {
    expect(directTransformPatch(true, { x: 10, y: 20 })).toBeNull();
    expect(directTransformPatch(false, { rotation: 15 })).toEqual({ rotation: 15 });
  });
});
