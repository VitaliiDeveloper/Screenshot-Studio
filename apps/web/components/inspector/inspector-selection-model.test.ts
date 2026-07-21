// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Project } from "@screenshot-studio/core/model";
import { deriveInspectorSelection } from "@web/components/inspector/inspector-selection-model";

function fixture(): Project {
  const element = (locked: boolean, visible: boolean) => ({
    id: "same",
    type: "shape" as const,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    opacity: 1,
    locked,
    visible,
    kind: "rect" as const,
    fill: "#000000",
    radius: 0,
  });
  return {
    meta: { name: "Inspector", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "primary",
    layouts: [{ id: "primary", name: "Primary", mode: "connected", screens: [
      {
        id: "first", name: "First", platform: "apple", device: "iphone", locale: "en", direction: "ltr",
        artboard: { width: 100, height: 200 }, background: { type: "solid", color: "#ffffff" },
        elements: [element(true, false), { ...element(true, false), id: "second" }],
      },
      {
        id: "other", name: "Other", platform: "apple", device: "iphone", locale: "en", direction: "ltr",
        artboard: { width: 100, height: 200 }, background: { type: "solid", color: "#ffffff" },
        elements: [element(false, true)],
      },
    ] }],
  };
}

describe("inspector selection model", () => {
  it("resolves a duplicate element id through its owner screen", () => {
    const model = deriveInspectorSelection(
      fixture(),
      "primary",
      "first",
      [{ screenId: "other", elementId: "same" }],
    );
    expect(model.screen.id).toBe("other");
    expect(model.element?.locked).toBe(false);
  });

  it("derives same-owner leaf batch actions and aggregate state", () => {
    const model = deriveInspectorSelection(fixture(), "primary", "first", [
      { screenId: "first", elementId: "same" },
      { screenId: "first", elementId: "second" },
    ]);
    expect(model.canGroup).toBe(true);
    expect(model.canUngroup).toBe(false);
    expect(model.everyLocked).toBe(true);
    expect(model.everyHidden).toBe(true);
    expect(model.aggregate).not.toBeNull();
  });

  it("refuses grouping across owner screens even when element ids match", () => {
    const model = deriveInspectorSelection(fixture(), "primary", "first", [
      { screenId: "first", elementId: "same" },
      { screenId: "other", elementId: "same" },
    ]);
    expect(model.canGroup).toBe(false);
  });
});
