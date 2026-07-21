// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { CanvasMode, DesignLayout } from "@screenshot-studio/core/model";
import { deriveStageModel } from "@web/components/editor-stage/stage-model";

function fixture(mode: CanvasMode): DesignLayout {
  const screen = (id: string, width: number, height: number): DesignLayout["screens"][number] => ({
    id,
    name: id,
    platform: "apple",
    device: "iphone",
    locale: "en",
    direction: "ltr",
    artboard: { width, height },
    background: { type: "solid", color: "#ffffff" },
    elements: [{
      id: `text-${id}`,
      type: "text",
      x: 10,
      y: 20,
      width: 80,
      height: 40,
      rotation: 0,
      opacity: 1,
      locked: false,
      visible: true,
      content: id,
      fontFamily: "Inter",
      weight: 400,
      size: 20,
      lineHeight: 1.2,
      letterSpacing: 0,
      align: "left",
      color: "#000000",
    }],
  });
  return {
    id: "primary",
    name: "Primary",
    mode,
    screens: [screen("first", 100, 200), screen("second", 120, 180)],
  };
}

describe("stage model", () => {
  it("derives the editable connected overview dimensions and owner-aware selection", () => {
    const model = deriveStageModel({
      layout: fixture("connected"),
      requestedScreenId: "first",
      activeScreenId: "first",
      selectedItems: [{ screenId: "second", elementId: "text-second" }],
      interactive: true,
      connectedOverview: true,
    });

    expect(model.projections.map(({ screen, x }) => [screen.id, x])).toEqual([
      ["first", 0],
      ["second", 100],
    ]);
    expect(model.stageWidth).toBe(220);
    expect(model.stageHeight).toBe(200);
    expect(model.baseX).toBe(0);
    expect(model.canEdit).toBe(true);
    expect(model.selectedElement?.id).toBe("text-second");
  });

  it("projects connected focus onto the requested crop without enabling editing", () => {
    const model = deriveStageModel({
      layout: fixture("connected"),
      requestedScreenId: "second",
      activeScreenId: "second",
      selectedItems: [],
      interactive: true,
      connectedOverview: false,
    });

    expect(model.baseX).toBe(-100);
    expect(model.stageWidth).toBe(120);
    expect(model.stageHeight).toBe(180);
    expect(model.canEdit).toBe(false);
  });

  it("keeps isolated editing scoped to the active requested screen", () => {
    const model = deriveStageModel({
      layout: fixture("isolated"),
      requestedScreenId: "first",
      activeScreenId: "first",
      selectedItems: [{ screenId: "first", elementId: "text-first" }],
      interactive: true,
      connectedOverview: false,
    });

    expect(model.projections).toHaveLength(1);
    expect(model.canEdit).toBe(true);
    expect(model.selectedElement?.id).toBe("text-first");
  });
});
