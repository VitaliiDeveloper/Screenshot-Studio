// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Element, Screen } from "@screenshot-studio/core/model";
import {
  marqueeBounds,
  marqueeHasMoved,
  resolveMarqueeSelection,
  stagePointerPosition,
} from "./marquee-selection-model.js";

function shape(id: string, x: number, visible = true): Element {
  return {
    id, type: "shape", x, y: 10, width: 20, height: 20,
    rotation: 0, opacity: 1, locked: false, visible,
    kind: "rect", fill: "#000000", radius: 0,
  };
}

function screen(id: string, elements: Element[]): Screen {
  return {
    id, name: id, platform: "apple", device: "iphone", locale: "en", direction: "ltr",
    artboard: { width: 100, height: 100 }, background: { type: "solid", color: "#ffffff" }, elements,
  };
}

describe("marquee selection model", () => {
  it("uses the existing 3 / zoom movement threshold", () => {
    expect(marqueeHasMoved({ x: 0, y: 0 }, { x: 2, y: 0 }, 1)).toBe(false);
    expect(marqueeHasMoved({ x: 0, y: 0 }, { x: 4, y: 0 }, 1)).toBe(true);
    expect(marqueeHasMoved({ x: 0, y: 0 }, { x: 1.6, y: 0 }, 2)).toBe(true);
  });

  it("keeps pointer coordinates in stage space when a crop offset exists", () => {
    const stage = { getPointerPosition: () => ({ x: 25, y: 40 }), scaleX: () => 0.5 };
    expect(stagePointerPosition(stage as never)).toEqual({ x: 50, y: 80 });
    expect(resolveMarqueeSelection({
      bounds: marqueeBounds({ x: 5, y: 5 }, { x: 35, y: 40 }),
      projections: [{ screen: screen("second", [shape("second-shape", 10)]), x: 100, y: 0 }],
      baseX: -100,
      initial: [],
      toggle: false,
    })).toEqual([{ screenId: "second", elementId: "second-shape" }]);
  });

  it("resolves visible owner-aware hits and modifier toggles", () => {
    const projections = [
      { screen: screen("first", [shape("first-shape", 10)]), x: 0, y: 0 },
      { screen: screen("second", [shape("second-shape", 10), shape("hidden", 40, false)]), x: 100, y: 0 },
    ];
    const bounds = marqueeBounds({ x: 105, y: 5 }, { x: 135, y: 40 });
    expect(resolveMarqueeSelection({
      bounds,
      projections,
      baseX: 0,
      initial: [{ screenId: "first", elementId: "first-shape" }],
      toggle: true,
    })).toEqual([
      { screenId: "first", elementId: "first-shape" },
      { screenId: "second", elementId: "second-shape" },
    ]);
  });
});
