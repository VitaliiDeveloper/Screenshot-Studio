// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Project } from "@screenshot-studio/core/model";
import {
  boundsIntersect,
  primarySelection,
  reconcileSelection,
  selectionBounds,
  toggleSelection,
  type SelectionRef,
} from "./editor-selection.js";

const first: SelectionRef = { screenId: "a", elementId: "same" };
const second: SelectionRef = { screenId: "b", elementId: "same" };

function fixture(mode: Project["mode"] = "connected"): Project {
  const element = (x: number, rotation = 0) => ({
    id: "same", type: "shape" as const, x, y: 10, width: 20, height: 10,
    rotation, opacity: 1, locked: false, visible: true,
    kind: "rect" as const, fill: "#000000", radius: 0,
  });
  return {
    meta: { name: "Selection", schemaVersion: 1 }, mode,
    platforms: ["apple"], locales: ["en"], fonts: [],
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

  it("uses inclusive intersection for marquee edge contact", () => {
    expect(boundsIntersect(
      { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      { minX: 10, minY: 5, maxX: 20, maxY: 15 },
    )).toBe(true);
  });
});
