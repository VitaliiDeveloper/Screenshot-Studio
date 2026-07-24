// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Element } from "@screenshot-studio/core/model";
import { elementKeepsAspectRatio, transformedDimensions } from "./element-transform-model.js";

function group(width: number, height: number): Extract<Element, { type: "group" }> {
  return {
    id: "group",
    type: "group",
    x: 0,
    y: 0,
    width,
    height,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    children: [],
  };
}

describe("element transform model", () => {
  const deviceFrame: Extract<Element, { type: "device-frame" }> = {
    id: "frame",
    type: "device-frame",
    x: 0,
    y: 0,
    width: 600,
    height: 1000,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    deviceType: "phone-modern-dark",
    fit: "cover",
  };

  it("identifies elements whose resize must preserve aspect ratio", () => {
    expect(elementKeepsAspectRatio(group(100, 50))).toBe(true);
    expect(elementKeepsAspectRatio(deviceFrame)).toBe(true);
    expect(elementKeepsAspectRatio(undefined)).toBe(false);
  });

  it("keeps uniform group resize dimensions", () => {
    expect(transformedDimensions(group(100, 50), 1.5, 2))
      .toEqual({ width: 175, height: 87.5 });
  });

  it("restores the device preset aspect ratio after resize", () => {
    expect(transformedDimensions(deviceFrame, 1.5, 1.5))
      .toEqual({ width: 900, height: 1950 });
  });

  it("keeps both canonical device-frame dimensions above the minimum", () => {
    const dimensions = transformedDimensions({
      ...deviceFrame,
      width: 160,
      height: 90,
      deviceType: "display-minimal",
    }, 0.001, 0.001);
    expect(dimensions.width).toBeCloseTo(80 / 9);
    expect(dimensions.height).toBeCloseTo(5);
  });

  it("keeps non-group dimensions independent and bounded", () => {
    const shape: Element = {
      id: "shape", type: "shape", x: 0, y: 0, width: 10, height: 20,
      rotation: 0, opacity: 1, locked: false, visible: true,
      kind: "rect", fill: "#000000", radius: 0,
    };
    expect(transformedDimensions(shape, 0.1, 2)).toEqual({ width: 5, height: 40 });
    expect(transformedDimensions(shape, -2, -0.5)).toEqual({ width: 20, height: 10 });
  });
});
