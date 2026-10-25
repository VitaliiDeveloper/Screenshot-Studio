// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Element, GroupElement, ShapeElement, TextElement } from "./schema.js";
import {
  cloneElementWithFreshIds,
  elementLeaves,
  mapElementLeaves,
  mirrorElement,
  mirrorGradientAngle,
} from "./element-tree.js";

type Box = Pick<Element, "x" | "y" | "width" | "height" | "rotation">;

/** Point in `box`'s local frame mapped through Konva's top-left-origin rotation. */
function toParent(box: Box, [px, py]: [number, number]): [number, number] {
  const radians = box.rotation * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [box.x + px * cos - py * sin, box.y + px * sin + py * cos];
}

function corners(box: Box): [number, number][] {
  return ([[0, 0], [box.width, 0], [0, box.height], [box.width, box.height]] as [number, number][])
    .map((point) => toParent(box, point));
}

/** The mirrored box's corners in the same order as the reflection of the source's corners. */
function expectReflected(source: [number, number][], mirrored: [number, number][], width: number) {
  const reflected = source.map(([x, y]) => [width - x, y]);
  [1, 0, 3, 2].forEach((sourceIndex, index) => {
    expect(mirrored[index]![0]).toBeCloseTo(reflected[sourceIndex]![0]!, 9);
    expect(mirrored[index]![1]).toBeCloseTo(reflected[sourceIndex]![1]!, 9);
  });
}

const text: TextElement = {
  id: "text", type: "text", x: 20, y: 10, width: 100, height: 40,
  rotation: 0, opacity: 1, locked: false, visible: true,
  content: "Hello", fontFamily: "Inter", size: 24, weight: 400,
  lineHeight: 1.2, letterSpacing: 0, align: "left", color: "#FFFFFF",
};
const shape: ShapeElement = {
  id: "shape", type: "shape", x: 180, y: 80, width: 80, height: 60,
  rotation: 0, opacity: 1, locked: false, visible: true,
  kind: "rect", fill: "#FF0000", radius: 0,
};
const group: GroupElement = {
  id: "group", type: "group", x: 100, y: 20, width: 300, height: 200,
  rotation: 0, opacity: 1, locked: false, visible: true,
  children: [text, shape],
};

describe("element tree helpers", () => {
  it("visits and maps every leaf while preserving the group transform", () => {
    expect(elementLeaves(group).map((leaf) => leaf.id)).toEqual(["text", "shape"]);
    const mapped = mapElementLeaves(group, (leaf) => ({ ...leaf, opacity: 0.5 }));
    expect(mapped).toMatchObject({ id: "group", x: 100, opacity: 1 });
    expect(mapped.type === "group" && mapped.children.every((leaf) => leaf.opacity === 0.5)).toBe(true);
  });

  it("regenerates the group and every child id", () => {
    const ids = ["new-group", "new-text", "new-shape"];
    const copy = cloneElementWithFreshIds(group, () => ids.shift()!);
    expect(copy.id).toBe("new-group");
    expect(copy.type === "group" && copy.children.map((child) => child.id)).toEqual(["new-text", "new-shape"]);
  });

  it("mirrors group placement, child placement, and physical text alignment exactly once", () => {
    const mirrored = mirrorElement(group, 1000);
    expect(mirrored).toMatchObject({ x: 600 });
    if (mirrored.type !== "group") throw new Error("expected group");
    expect(mirrored.children[0]).toMatchObject({ x: 180, align: "right" });
    expect(mirrored.children[1]).toMatchObject({ x: 40 });
    expect(mirrorElement(mirrored, 1000)).toEqual(group);
  });

  it("mirrors a rotated leaf onto the reflection of its corners and back", () => {
    const rotated: ShapeElement = { ...shape, x: 300, y: 400, width: 200, height: 120, rotation: 30 };
    const mirrored = mirrorElement(rotated, 1000);
    expect(mirrored.rotation).toBe(-30);
    expectReflected(corners(rotated), corners(mirrored), 1000);

    const restored = mirrorElement(mirrored, 1000);
    expect(restored).toMatchObject({ rotation: 30, x: expect.closeTo(300, 9), y: expect.closeTo(400, 9) });
  });

  it("mirrors a rotated group and its rotated children in artboard space", () => {
    const rotated: GroupElement = {
      ...group,
      rotation: 20,
      children: [{ ...text, rotation: -15 }, { ...shape, rotation: 40 }],
    };
    const mirrored = mirrorElement(rotated, 1000);
    if (mirrored.type !== "group") throw new Error("expected group");
    expect(mirrored.rotation).toBe(-20);
    rotated.children.forEach((child, index) => {
      const world = (parent: Box, leaf: Box) => corners(leaf).map((point) => toParent(parent, point));
      expectReflected(world(rotated, child), world(mirrored, mirrored.children[index]!), 1000);
    });
  });

  it("flips text shadow and shape gradient direction and restores them when mirrored twice", () => {
    const styled: GroupElement = {
      ...group,
      children: [
        { ...text, shadow: { color: "#000000", blur: 4, offsetX: 12, offsetY: 6, opacity: 0.5 } },
        { ...shape, gradient: { from: "#000000", to: "#FFFFFF", angle: 30 } },
      ],
    };
    const mirrored = mirrorElement(styled, 1000);
    if (mirrored.type !== "group") throw new Error("expected group");
    expect(mirrored.children[0]).toMatchObject({ shadow: { offsetX: -12, offsetY: 6 } });
    expect(mirrored.children[1]).toMatchObject({ gradient: { angle: 150 } });
    expect(mirrorElement(mirrored, 1000)).toEqual(styled);
  });

  it("reflects gradient angles horizontally within the schema range", () => {
    expect([0, 45, 90, 180, 270, 315, 360].map(mirrorGradientAngle)).toEqual([180, 135, 90, 0, 270, 225, 180]);
  });
});
