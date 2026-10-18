// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it } from "vitest";
import {
  createShapeElement,
  createTextElement,
  getLayout,
  TEXT_SHADOW_BLUR_MAX,
  parseProject,
  type Element,
  type Project,
  type TextElement,
} from "@screenshot-studio/core/model";
import { applyScopeScreens, scopedElementPatches } from "./editor-apply-scope";
import { editorStore } from "./editor-store";

const title = (id: string, extra: Partial<TextElement> = {}): Element =>
  ({ ...createTextElement({}), id, x: 100, size: 100, ...extra });

function screen(id: string, elements: Element[], extra: Record<string, unknown> = {}) {
  return {
    id,
    // Destination copies keep their slot's name: "hero-ipad" is named "hero".
    name: id.split("-")[0],
    platform: "apple",
    device: "iphone",
    locale: "en",
    artboard: { width: 1206, height: 2622 },
    background: { type: "solid", color: "#101827" },
    elements,
    ...extra,
  };
}

const variant = (id: string, storeTargetId: string, elements: Element[]) => screen(id, elements, {
  artboard: { width: 1320, height: 2868 },
  variantOf: "hero",
  storeTargetId,
});

function fixture(): Project {
  return parseProject({
    meta: { name: "Scope", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [{
      id: "default",
      name: "Default",
      mode: "isolated",
      screens: [
        screen("hero", [title("title"), { ...createShapeElement({}), id: "badge" }]),
        variant("hero-69", "6.9", [title("title-69"), { ...createShapeElement({}), id: "badge-69" }]),
        variant("hero-61", "6.1", [title("title-61", { locked: true }), { ...createShapeElement({}), id: "badge-61" }]),
        screen("details", [title("details-title")]),
        screen("hero-ipad", [title("title-ipad"), { ...createShapeElement({}), id: "badge-ipad" }], { device: "ipad" }),
        screen("details-ipad", [title("details-title-ipad")], { device: "ipad" }),
        screen("hero-de", [title("title-de"), { ...createShapeElement({}), id: "badge-de" }], { locale: "de" }),
      ],
    }],
  });
}

const ids = (screens: readonly { id: string }[]) => screens.map(({ id }) => id);

function element(project: Project, screenId: string, elementId: string): TextElement {
  const owner = getLayout(project, "default").screens.find(({ id }) => id === screenId)!;
  return owner.elements.find(({ id }) => id === elementId) as TextElement;
}

describe("applyScopeScreens", () => {
  const layout = getLayout(fixture(), "default");

  const reach = (target: typeof layout, source: string, scope: "screen" | "family" | "destinations") => {
    const { screens, skippedDestinations } = applyScopeScreens(
      target,
      target.screens.find(({ id }) => id === source)!,
      scope,
    );
    return { screens: ids(screens), skippedDestinations };
  };

  it("widens from the screen to its slot to that slot in every destination of the locale", () => {
    expect(reach(layout, "hero", "screen")).toEqual({ screens: ["hero"], skippedDestinations: 0 });
    expect(reach(layout, "hero", "family"))
      .toEqual({ screens: ["hero", "hero-69", "hero-61"], skippedDestinations: 0 });
    expect(reach(layout, "hero", "destinations"))
      .toEqual({ screens: ["hero", "hero-69", "hero-61", "hero-ipad"], skippedDestinations: 0 });
  });

  it("resolves the same scope from a variant and never crosses into another locale", () => {
    expect(reach(layout, "hero-69", "destinations").screens).toEqual(["hero", "hero-69", "hero-61", "hero-ipad"]);
    expect(reach(layout, "details", "destinations").screens).toEqual(["details", "details-ipad"]);
  });

  it("skips a destination whose screen order diverged instead of editing an unrelated screen", () => {
    const moved = layout.screens.filter(({ device }) => device === "ipad").reverse();
    const diverged = { ...layout, screens: [...layout.screens.filter(({ device }) => device !== "ipad"), ...moved] };
    expect(reach(diverged, "hero", "destinations"))
      .toEqual({ screens: ["hero", "hero-69", "hero-61"], skippedDestinations: 1 });
    expect(reach(diverged, "details", "destinations")).toEqual({ screens: ["details"], skippedDestinations: 1 });
  });
});

describe("scopedElementPatches", () => {
  const layout = getLayout(fixture(), "default");

  it("copies plain fields, fits pixel metrics per artboard, and skips locked layers", () => {
    const { writes, skippedSizes } = scopedElementPatches(
      layout,
      "hero",
      "title",
      { type: "text", patch: { color: "#FF0000", size: 120, shadow: null } },
      "family",
    );
    expect(writes.map(({ screenId, elementId }) => `${screenId}/${elementId}`))
      .toEqual(["hero/title", "hero-69/title-69"]);
    expect(skippedSizes).toBe(1);
    expect(writes[0]!.patch).toEqual({ color: "#FF0000", size: 120, shadow: null });
    const fitted = writes[1]!.patch as { color: string; size: number; shadow: null };
    expect(fitted.color).toBe("#FF0000");
    expect(fitted.shadow).toBeNull();
    expect(fitted.size).toBeCloseTo(120 * Math.min(1320 / 1206, 2868 / 2622));
  });

  it("writes only the edited layer when the scope is this screen", () => {
    expect(scopedElementPatches(layout, "hero", "title", { type: "text", patch: { size: 90 } }, "screen"))
      .toEqual({ writes: [{ screenId: "hero", elementId: "title", patch: { size: 90 } }], skippedSizes: 0 });
  });

  it("skips and counts a size that cannot take the fitted value", () => {
    const shadow = { color: "#000000", blur: TEXT_SHADOW_BLUR_MAX, offsetX: 0, offsetY: 0, opacity: 1 };
    const { writes, skippedSizes } = scopedElementPatches(
      layout,
      "hero",
      "title",
      { type: "text", patch: { shadow } },
      "family",
    );
    // Scaling up to 6.9" would push the blur past its maximum; 6.1" is locked.
    expect(writes.map(({ screenId }) => screenId)).toEqual(["hero"]);
    expect(skippedSizes).toBe(2);
  });
});

describe("editorStore apply scope", () => {
  beforeEach(() => {
    editorStore.getState().load(fixture());
  });

  it("writes one edit to every screen in scope as one undo step and leaves other locales alone", () => {
    const before = editorStore.getState().project!;
    const { patchElement } = editorStore.getState();
    patchElement({ id: "title", screenId: "hero", type: "text", patch: { content: "Sa" }, scope: "destinations" });
    patchElement({ id: "title", screenId: "hero", type: "text", patch: { content: "Save" }, scope: "destinations" });

    const after = editorStore.getState();
    expect(after.historyPast).toHaveLength(1);
    for (const [screenId, elementId] of [["hero", "title"], ["hero-69", "title-69"], ["hero-ipad", "title-ipad"]]) {
      expect(element(after.project!, screenId!, elementId!).content).toBe("Save");
    }
    expect(element(after.project!, "hero-61", "title-61").content).toBe("Text");
    expect(getLayout(after.project!, "default").screens.find(({ id }) => id === "hero-de"))
      .toBe(getLayout(before, "default").screens.find(({ id }) => id === "hero-de"));

    editorStore.getState().undo();
    expect(getLayout(editorStore.getState().project!, "default").screens)
      .toEqual(getLayout(before, "default").screens);
  });

  it("writes a background across the slot as one undo step", () => {
    editorStore.getState().selectScreen("hero");
    editorStore.getState().setBackground({ type: "solid", color: "#FFFFFF" }, "family");
    const state = editorStore.getState();
    const screens = getLayout(state.project!, "default").screens;
    expect(state.historyPast).toHaveLength(1);
    expect(screens.filter(({ background }) => background.type === "solid" && background.color === "#FFFFFF")
      .map(({ id }) => id)).toEqual(["hero", "hero-69", "hero-61"]);
  });
});
