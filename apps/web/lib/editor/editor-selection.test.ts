// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { CanvasMode, DesignLayout } from "@screenshot-studio/core/model";
import {
  arrangeSelectionDeltas,
  boundsIntersect,
  primarySelection,
  reconcileSelection,
  selectionBounds,
  selectionKey,
  toggleSelection,
  type SelectionRef,
} from "./editor-selection.js";

const first: SelectionRef = { screenId: "a", elementId: "same" };
const second: SelectionRef = { screenId: "b", elementId: "same" };

function fixture(mode: CanvasMode = "connected"): DesignLayout {
  const element = (x: number, rotation = 0) => ({
    id: "same", type: "shape" as const, x, y: 10, width: 20, height: 10,
    rotation, opacity: 1, locked: false, visible: true,
    kind: "rect" as const, fill: "#000000", radius: 0,
  });
  return {
    id: "primary", name: "Primary", mode,
    screens: [
      {
        id: "a", name: "A", platform: "apple", device: "iphone", locale: "en", direction: "ltr",
        artboard: { width: 100, height: 100 }, background: { type: "solid", color: "#ffffff" },
        elements: [element(10)],
      },
      {
        id: "b", name: "B", platform: "apple", device: "iphone", locale: "en", direction: "ltr",
        artboard: { width: 120, height: 100 }, background: { type: "solid", color: "#ffffff" },
        elements: [element(5, 90)],
      },
    ],
  };
}

describe("editor selection", () => {
  it("toggles composite identities while preserving deterministic primary order", () => {
    const selected = toggleSelection(toggleSelection([], first), second);
    expect(selected).toEqual([first, second]);
    expect(primarySelection(selected)).toEqual(second);
    expect(toggleSelection(selected, first)).toEqual([second]);
  });

  it("reconciles to the editable connected group and preserves duplicate ids by owner", () => {
    expect(reconcileSelection(fixture(), "a", [first, second, first])).toEqual([first, second]);
    expect(reconcileSelection(fixture("isolated"), "a", [first, second])).toEqual([first]);
  });

  it("computes aggregate rotation-aware bounds in connected stage coordinates", () => {
    expect(selectionBounds(fixture(), "a", [first, second])).toEqual({
      minX: 10,
      minY: 10,
      maxX: 105,
      maxY: 30,
    });
  });

  it("aligns rotation-aware bounds, not raw positions, against connected selection bounds", () => {
    // Screen b starts at stage x=100; its 90° element spans local x -5..5 although x=5.
    const deltas = (action: Parameters<typeof arrangeSelectionDeltas>[3]) => {
      const result = arrangeSelectionDeltas(fixture(), "a", [first, second], action);
      return [result.get(selectionKey(first))!, result.get(selectionKey(second))!];
    };
    const expectDeltas = (action: Parameters<typeof deltas>[0], expected: [number, number][]) => {
      deltas(action).forEach((delta, index) => {
        expect(delta.x).toBeCloseTo(expected[index]![0]);
        expect(delta.y).toBeCloseTo(expected[index]![1]);
      });
    };

    expectDeltas("left", [[0, 0], [-85, 0]]);
    expectDeltas("center", [[37.5, 0], [-42.5, 0]]);
    expectDeltas("right", [[75, 0], [0, 0]]);
    expectDeltas("top", [[0, 0], [0, 0]]);
    expectDeltas("middle", [[0, 5], [0, 0]]);
    expectDeltas("bottom", [[0, 10], [0, 0]]);
  });

  it("distributes equal gaps between rotated and unrotated bounds and keeps the outer layers fixed", () => {
    const layout = fixture("isolated");
    const base = layout.screens[0]!.elements[0]!;
    layout.screens[0]!.elements = [
      { ...base, id: "start", x: 0, y: 0, width: 10, height: 10 },
      // 90° rotation around the top-left corner: bounds x 20..30, y 0..20.
      { ...base, id: "rotated", x: 30, y: 0, width: 20, height: 10, rotation: 90 },
      { ...base, id: "end", x: 90, y: 80, width: 10, height: 20 },
    ];
    const ref = (elementId: string): SelectionRef => ({ screenId: "a", elementId });
    const selections = [ref("end"), ref("start"), ref("rotated")];

    const horizontal = arrangeSelectionDeltas(layout, "a", selections, "distribute-horizontal");
    expect(horizontal.get(selectionKey(ref("start")))).toEqual({ x: 0, y: 0 });
    expect(horizontal.get(selectionKey(ref("rotated")))!.x).toBeCloseTo(25);
    expect(horizontal.get(selectionKey(ref("rotated")))!.y).toBe(0);
    expect(horizontal.get(selectionKey(ref("end")))!.x).toBeCloseTo(0);

    // Heights 10 + 20 + 20 in a 0..100 span leave two 25px gaps.
    const vertical = arrangeSelectionDeltas(layout, "a", selections, "distribute-vertical");
    expect(vertical.get(selectionKey(ref("start")))).toEqual({ x: 0, y: 0 });
    expect(vertical.get(selectionKey(ref("rotated")))!.y).toBeCloseTo(35);
    expect(vertical.get(selectionKey(ref("end")))!.y).toBeCloseTo(0);

    expect(arrangeSelectionDeltas(fixture(), "a", [first, second], "distribute-horizontal").size).toBe(0);
  });

  it("uses inclusive intersection for marquee edge contact", () => {
    expect(boundsIntersect(
      { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      { minX: 10, minY: 5, maxX: 20, maxY: 15 },
    )).toBe(true);
  });
});
