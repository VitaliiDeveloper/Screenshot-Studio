// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Element } from "@screenshot-studio/core/model";
import { transformedDimensions } from "@web/components/editor-stage/element-transform-model.js";

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
  it("keeps uniform group resize dimensions", () => {
    expect(transformedDimensions(group(100, 50), 1.5, 2))
      .toEqual({ width: 175, height: 87.5 });
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
