// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Element, Screen } from "@screenshot-studio/core/model";
import { snapElementDrag, type SnapProjection } from "@web/lib/editor-snapping.js";

function shape(id: string, x: number, y: number, width = 100, height = 100, rotation = 0): Element {
  return {
    id,
    type: "shape",
    x,
    y,
    width,
    height,
    rotation,
    opacity: 1,
    locked: false,
    visible: true,
    kind: "rect",
    fill: "#FF0000",
    radius: 0,
  };
}

function screen(id: string, elements: Element[], width = 1000, height = 800): Screen {
  return {
    id,
    name: id,
    platform: "apple",
    device: "iphone",
    locale: "en",
    direction: "ltr",
    artboard: { width, height },
    background: { type: "solid", color: "#000000" },
    elements,
  };
}

function snap(
  element: Element,
  position: { x: number; y: number },
  projections: SnapProjection[],
  zoom = 1,
) {
  return snapElementDrag({
    element,
    ownerScreenId: projections[0]!.screen.id,
    position,
    projections,
    stage: {
      width: projections.reduce((max, projection) => (
        Math.max(max, projection.x + projection.screen.artboard.width)
      ), 0),
      height: Math.max(...projections.map((projection) => projection.screen.artboard.height)),
    },
    zoom,
  });
}

describe("editor snapping", () => {
  it("snaps an element centre to an artboard centre", () => {
    const moving = shape("moving", 100, 100, 120, 80);
    const projections = [{ screen: screen("one", [moving]), x: 0, y: 0 }];
    const result = snap(moving, { x: 435, y: 100 }, projections);

    expect(result.position.x).toBe(440);
    expect(result.guides).toContainEqual({
      axis: "x",
      position: 500,
      targetKind: "artboard",
      targetId: "one",
    });
  });

  it("keeps a six-pixel screen threshold across zoom levels", () => {
    const moving = shape("moving", 100, 100, 120, 80);
    const projections = [{ screen: screen("one", [moving]), x: 0, y: 0 }];

    expect(snap(moving, { x: 432, y: 100 }, projections, 1).position.x).toBe(432);
    const zoomedOut = snap(moving, { x: 432, y: 100 }, projections, 0.5);
    expect(zoomedOut.position.x).toBe(440);
    expect(zoomedOut.guides.find((guide) => guide.axis === "x")?.position).toBe(500);
  });

  it("aligns across owner screens while returning owner-local coordinates", () => {
    const moving = shape("moving", 100, 100, 200, 200);
    const target = shape("target", 160, 500, 200, 200);
    const projections = [
      { screen: screen("one", [moving], 660, 1000), x: 0, y: 0 },
      { screen: screen("two", [target], 660, 1000), x: 660, y: 0 },
    ];
    const result = snap(moving, { x: 614, y: 100 }, projections);

    expect(result.position.x).toBe(620);
    expect(result.guides).toContainEqual({
      axis: "x",
      position: 820,
      targetKind: "element",
      targetId: "two:target",
    });
  });

  it("uses rotation-aware bounds", () => {
    const moving = shape("moving", 100, 100, 100, 50, 90);
    const projections = [{ screen: screen("one", [moving]), x: 0, y: 0 }];
    const result = snap(moving, { x: 54, y: 200 }, projections);

    expect(result.position.x).toBeCloseTo(50);
    expect(result.guides.find((guide) => guide.axis === "x")?.position).toBe(0);
  });

  it("ignores hidden and transparent elements as alignment targets", () => {
    const moving = shape("moving", 100, 100);
    const hidden = { ...shape("hidden", 450, 500), visible: false };
    const transparent = { ...shape("transparent", 700, 500), opacity: 0 };
    const projections = [{ screen: screen("one", [moving, hidden, transparent]), x: 0, y: 0 }];

    const result = snap(moving, { x: 344, y: 100 }, projections);
    expect(result.position.x).toBe(344);
    expect(result.guides.find((guide) => guide.targetKind === "element")).toBeUndefined();
  });
});
