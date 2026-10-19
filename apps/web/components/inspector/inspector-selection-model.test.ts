// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Project } from "@screenshot-studio/core/model";
import { deriveInspectorSelection } from "./inspector-selection-model";

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
    expect(model.canDuplicate).toBe(true);
    expect(model.canAlign).toBe(false);
    expect(model.selectedElements.map((element) => element.id)).toEqual(["same", "second"]);
    expect(model.everyLocked).toBe(true);
    expect(model.everyHidden).toBe(true);
    expect(model.aggregate).not.toBeNull();
  });

  it("groups selection refs by element type in first-seen order", () => {
    const project = fixture();
    project.layouts[0]!.screens[0]!.elements.push({
      id: "group",
      type: "group",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotation: 0,
      opacity: 1,
      locked: false,
      visible: true,
      children: [],
    });
    const model = deriveInspectorSelection(project, "primary", "first", [
      { screenId: "first", elementId: "same" },
      { screenId: "first", elementId: "group" },
      { screenId: "first", elementId: "second" },
    ]);
    expect(model.selectionTypeGroups).toEqual([
      { type: "shape", items: [
        { screenId: "first", elementId: "same" },
        { screenId: "first", elementId: "second" },
      ] },
      { type: "group", items: [{ screenId: "first", elementId: "group" }] },
    ]);
  });

  it("refuses grouping across owner screens even when element ids match", () => {
    const model = deriveInspectorSelection(fixture(), "primary", "first", [
      { screenId: "first", elementId: "same" },
      { screenId: "other", elementId: "same" },
    ]);
    expect(model.canGroup).toBe(false);
    expect(model.canAlign).toBe(true);
    expect(model.canDistribute).toBe(false);

    const lockedPrimary = fixture();
    lockedPrimary.layouts[0]!.screens[1]!.elements[0]!.opacity = 0.4;
    expect(deriveInspectorSelection(lockedPrimary, "primary", "first", [
      { screenId: "other", elementId: "same" },
      { screenId: "first", elementId: "same" },
    ]).sharedOpacity).toBe(0.4);
  });

  it("treats an unlocked child of a locked group as effectively locked", () => {
    const project = fixture();
    project.layouts[0]!.screens[0]!.elements.push({
      id: "locked-group",
      type: "group",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      locked: true,
      visible: true,
      children: [{
        id: "unlocked-child",
        type: "shape",
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        rotation: 0,
        opacity: 1,
        locked: false,
        visible: true,
        kind: "rect",
        fill: "#ffffff",
        radius: 0,
      }],
    });

    const model = deriveInspectorSelection(
      project,
      "primary",
      "first",
      [{ screenId: "first", elementId: "unlocked-child" }],
    );

    expect(model.element?.locked).toBe(false);
    expect(model.effectiveLocked).toBe(true);
    // duplicateSelected copies top-level layers only.
    expect(model.canDuplicate).toBe(false);
  });
});
