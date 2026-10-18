// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { createShapeElement, type DesignLayout } from "@screenshot-studio/core/model";
import { deriveSelectionOverlay } from "./selection-overlay-model";

const shape = (id: string, x: number, rotation = 0) => ({
  ...createShapeElement(), id, x, y: 100, width: 200.4, height: 99.6, rotation,
});

const layout: DesignLayout = {
  id: "default",
  name: "Default",
  mode: "isolated",
  screens: [{
    id: "hero",
    name: "Hero",
    platform: "apple",
    device: "iphone",
    locale: "en",
    direction: "ltr",
    artboard: { width: 1000, height: 2000 },
    background: { type: "solid", color: "#ffffff" },
    elements: [shape("a", 100), shape("b", 500, 90)],
  }],
};

describe("deriveSelectionOverlay", () => {
  it("labels one layer by its box, even when rotated, and places it by its rotated bounds", () => {
    const rotated = layout.screens[0]!.elements[1]!;
    const overlay = deriveSelectionOverlay({
      layout,
      activeScreenId: "hero",
      selectedItems: [{ screenId: "hero", elementId: "b" }],
      selectedElement: rotated,
    });
    expect(overlay?.sizeLabel).toBe("200 × 100");
    expect(overlay?.bounds.minX).toBeCloseTo(400.4);
    expect(overlay?.bounds.maxY).toBeCloseTo(300.4);
  });

  it("labels a multi-selection by its union bounds and needs a resolvable selection", () => {
    const items = [{ screenId: "hero", elementId: "a" }, { screenId: "hero", elementId: "b" }];
    expect(deriveSelectionOverlay({ layout, activeScreenId: "hero", selectedItems: items, selectedElement: undefined })?.sizeLabel)
      .toBe("400 × 200");
    expect(deriveSelectionOverlay({ layout, activeScreenId: "hero", selectedItems: [], selectedElement: undefined })).toBeNull();
    expect(deriveSelectionOverlay({ layout, activeScreenId: null, selectedItems: items, selectedElement: undefined })).toBeNull();
  });
});
