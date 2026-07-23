// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Element } from "./schema.js";
import { cloneElementWithFreshIds, elementLeaves, mapElementLeaves, mirrorElement } from "./element-tree.js";

const group: Element = {
  id: "group", type: "group", x: 100, y: 20, width: 300, height: 200,
  rotation: 0, opacity: 1, locked: false, visible: true,
  children: [
    {
      id: "text", type: "text", x: 20, y: 10, width: 100, height: 40,
      rotation: 0, opacity: 1, locked: false, visible: true,
      content: "Hello", fontFamily: "Inter", size: 24, weight: 400,
      lineHeight: 1.2, letterSpacing: 0, align: "left", color: "#FFFFFF",
    },
    {
      id: "shape", type: "shape", x: 180, y: 80, width: 80, height: 60,
      rotation: 0, opacity: 1, locked: false, visible: true,
      kind: "rect", fill: "#FF0000", radius: 0,
    },
  ],
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
});
