// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { createTextElement, type GroupElement, type Screen } from "@screenshot-studio/core/model";
import type { ProjectIssue } from "@screenshot-studio/core/validation";
import { deriveTextOverflowMarks } from "./text-overflow-model";

const text = (id: string, extra: Partial<ReturnType<typeof createTextElement>> = {}) => ({
  ...createTextElement({ x: 100, y: 200 }),
  id,
  width: 300,
  height: 60,
  ...extra,
});

function screen(id: string, elements: Screen["elements"]): Screen {
  return {
    id,
    name: id,
    platform: "apple",
    device: "iphone",
    locale: "en",
    direction: "ltr",
    artboard: { width: 1000, height: 2000 },
    background: { type: "solid", color: "#ffffff" },
    elements,
  };
}

const overflow = (screenId: string, elementId: string): ProjectIssue => ({
  kind: "text-overflow",
  id: `text-overflow:${screenId}:${elementId}`,
  level: "warning",
  layoutId: "default",
  screenId,
  elementId,
});

const measure = { contentHeight: () => 84, fitSize: () => 40 };

describe("deriveTextOverflowMarks", () => {
  it("marks only the visible text layers Issues reports, on the projected screens", () => {
    const group: GroupElement = {
      id: "group",
      type: "group",
      x: 50,
      y: 70,
      width: 400,
      height: 300,
      rotation: 90,
      opacity: 1,
      locked: false,
      visible: true,
      children: [text("nested", { x: 10, y: 20 })],
    };
    const first = screen("first", [text("hero"), text("fits"), text("hidden", { visible: false }), group]);
    const other = screen("other", [text("hero")]);
    const marks = deriveTextOverflowMarks({
      projections: [{ screen: first, x: 1000, y: 0 }],
      baseX: -1000,
      issues: [
        overflow("first", "hero"),
        overflow("first", "hidden"),
        overflow("first", "nested"),
        overflow("other", "hero"),
        { kind: "missing-image", id: "img", level: "blocker", layoutId: "default", screenId: "first", elementId: "fits", assetUrl: "a.png" },
      ],
      measure,
    });

    expect(marks.map((mark) => [mark.element.id, mark.parent?.id])).toEqual([["hero", undefined], ["nested", "group"]]);
    expect(marks[0]).toMatchObject({ screenId: "first", origin: { x: 0, y: 0 }, contentHeight: 84, fitSize: 40, hint: { x: 100, y: 260 } });
    // Nested box bottom-left (10, 80) in group space, turned 90° and offset by the group origin.
    expect(marks[1]!.hint.x).toBeCloseTo(-30);
    expect(marks[1]!.hint.y).toBeCloseTo(80);
    expect(deriveTextOverflowMarks({ projections: [{ screen: other, x: 0, y: 0 }], baseX: 0, issues: [], measure })).toEqual([]);
  });

  it("follows the layer rotation for the hint corner", () => {
    const rotated = screen("s", [text("hero", { rotation: -90 })]);
    const [mark] = deriveTextOverflowMarks({
      projections: [{ screen: rotated, x: 0, y: 0 }],
      baseX: 0,
      issues: [overflow("s", "hero")],
      measure,
    });
    expect(mark!.hint.x).toBeCloseTo(160);
    expect(mark!.hint.y).toBeCloseTo(200);
  });
});
