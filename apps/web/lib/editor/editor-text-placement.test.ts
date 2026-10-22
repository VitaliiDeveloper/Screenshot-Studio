// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_STORE_SPECS, findStoreTarget } from "@screenshot-studio/core/export";
import {
  createTextElement,
  rotatedElementBounds,
  type Element,
  type Project,
  type Screen,
} from "@screenshot-studio/core/model";
import { findBuiltInTemplate } from "@screenshot-studio/core/templates";
import { editorStore } from "./editor-store.js";
import { hasPlaceableText, placeScreenText, type TextPlacement } from "./editor-text-placement.js";

function templateScreen(templateId: string, direction: Screen["direction"] = "ltr"): Screen {
  const template = findBuiltInTemplate(templateId, DEFAULT_STORE_SPECS)!;
  const headline = template.elements.find((element) => element.id === "headline")!;
  const subtitle = {
    ...createTextElement({ x: headline.x, y: headline.y + headline.height }),
    id: "subtitle",
    width: headline.width,
    height: headline.height / 3,
  };
  return {
    id: "hero",
    name: "Hero",
    platform: template.platform,
    device: template.device,
    locale: "en",
    direction,
    artboard: template.artboard,
    background: template.background,
    elements: [...template.elements, subtitle],
  } as Screen;
}

const isText = (element: Element) => element.type === "text";
const isMockup = (element: Element) => element.type === "device-frame";

function blockCenter(screen: Screen, belongs: (element: Element) => boolean) {
  const bounds = screen.elements.filter(belongs).map(rotatedElementBounds);
  const [minX, maxX] = [Math.min(...bounds.map((b) => b.minX)), Math.max(...bounds.map((b) => b.maxX))];
  const [minY, maxY] = [Math.min(...bounds.map((b) => b.minY)), Math.max(...bounds.map((b) => b.maxY))];
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, minX, maxX, minY, maxY };
}

// Centers of the text and media blocks as fractions of the artboard (Side: text on the start edge).
const CENTERS: Record<TextPlacement, { text: [number, number]; media: [number, number] }> = {
  top: { text: [0.5, 0.18], media: [0.5, 0.65] },
  bottom: { text: [0.5, 0.82], media: [0.5, 0.35] },
  side: { text: [0.29, 0.5], media: [0.75, 0.5] },
};

describe.each([
  ["iPhone portrait", "iphone-starter"],
  ["iPad landscape", "ipad-landscape-starter"],
])("text placement on %s", (_label, templateId) => {
  const screen = templateScreen(templateId);
  const { width, height } = screen.artboard;

  it.each(["top", "bottom", "side"] as const)("%s centers each block in its region of the artboard", (placement) => {
    const placed = placeScreenText(screen, placement);
    const text = blockCenter(placed, isText);
    const media = blockCenter(placed, isMockup);

    expect([text.x / width, text.y / height]).toEqual(CENTERS[placement].text.map((c) => expect.closeTo(c, 6)));
    expect([media.x / width, media.y / height]).toEqual(CENTERS[placement].media.map((c) => expect.closeTo(c, 6)));
  });

  it.each(["top", "bottom", "side"] as const)("%s keeps both blocks inside the artboard and apart", (placement) => {
    const placed = placeScreenText(screen, placement);
    const text = blockCenter(placed, isText);
    const media = blockCenter(placed, isMockup);

    for (const block of [text, media]) {
      expect(block.minX).toBeGreaterThanOrEqual(0);
      expect(block.minY).toBeGreaterThanOrEqual(0);
      expect(block.maxX).toBeLessThanOrEqual(width);
      expect(block.maxY).toBeLessThanOrEqual(height);
    }
    const apart = placement === "top" ? text.maxY <= media.minY
      : placement === "bottom" ? media.maxY <= text.minY
      : text.maxX <= media.minX;
    expect(apart).toBe(true);
  });

  it("scales a block down uniformly to fit its region and never enlarges it", () => {
    const original = screen.elements.find((element) => element.id === "mockup")!;
    const placed = placeScreenText(screen, "side").elements.find((element) => element.id === "mockup")!;

    expect(placed.width).toBeLessThanOrEqual(original.width);
    expect(placed.width / placed.height).toBeCloseTo(original.width / original.height, 6);
    const small = placeScreenText(screen, "top").elements.find((element) => element.id === "headline")!;
    expect(small).toMatchObject({
      width: screen.elements.find((element) => element.id === "headline")!.width,
      height: screen.elements.find((element) => element.id === "headline")!.height,
    });
  });
});

describe("text placement rules", () => {
  it("puts Side text on the start edge of a right-to-left screen", () => {
    const screen = templateScreen("iphone-starter", "rtl");
    const placed = placeScreenText(screen, "side");

    expect(blockCenter(placed, isText).x / screen.artboard.width).toBeCloseTo(0.71, 6);
    expect(blockCenter(placed, isMockup).x / screen.artboard.width).toBeCloseTo(0.25, 6);
  });

  it("leaves hidden, locked and other layers where they are", () => {
    const screen = templateScreen("iphone-starter");
    const marked: Element[] = screen.elements.map((element) => element.id === "subtitle"
      ? { ...element, locked: true }
      : element.id === "mockup" ? { ...element, visible: false } : element);
    const placed = placeScreenText({ ...screen, elements: marked }, "bottom");

    for (const id of ["subtitle", "mockup", "accent"]) {
      expect(placed.elements.find((element) => element.id === id)).toBe(marked.find((element) => element.id === id));
    }
    expect(placed.elements.find((element) => element.id === "headline"))
      .not.toBe(marked.find((element) => element.id === "headline"));
  });

  it("returns the same screen when there is no text layer to place", () => {
    const screen = templateScreen("iphone-starter");
    const withoutText = { ...screen, elements: screen.elements.filter((element) => element.type !== "text") };

    expect(hasPlaceableText(withoutText)).toBe(false);
    expect(placeScreenText(withoutText, "top")).toBe(withoutText);
  });
});

describe("text placement in the editor store", () => {
  const iphone = (id: string) => findStoreTarget(DEFAULT_STORE_SPECS, "apple", "iphone", id);

  beforeEach(() => {
    const screen = templateScreen("iphone-starter");
    const project: Project = {
      meta: { name: "T", schemaVersion: 1 },
      fonts: [],
      preferredExportLayoutId: "default",
      layouts: [{ id: "default", name: "Default", mode: "isolated", screens: [screen] }],
    };
    editorStore.getState().load(project);
  });

  const screens = () => editorStore.getState().project!.layouts[0]!.screens;

  it("writes the preset as one undo step and stores nothing else on the screen", () => {
    const before = screens()[0]!;

    editorStore.getState().placeText("bottom");

    expect(editorStore.getState().historyPast).toHaveLength(1);
    expect(Object.keys(screens()[0]!).sort()).toEqual(Object.keys(before).sort());
    expect(screens()[0]!.elements.find((element) => element.id === "headline")!.y)
      .not.toBe(before.elements.find((element) => element.id === "headline")!.y);

    editorStore.getState().undo();

    expect(screens()[0]).toEqual(before);
  });

  it("records no step when the screen has no text layer", () => {
    editorStore.getState().removeElement("headline");
    editorStore.getState().removeElement("subtitle");
    const past = editorStore.getState().historyPast.length;

    editorStore.getState().placeText("top");

    expect(editorStore.getState().historyPast).toHaveLength(past);
  });

  it("follows Apply to: every size of the slot is placed against its own artboard in one step", () => {
    editorStore.getState().ensureStoreTargetVariant(iphone("6.5"));
    const past = editorStore.getState().historyPast.length;

    editorStore.getState().placeText("top", "family");

    expect(editorStore.getState().historyPast).toHaveLength(past + 1);
    for (const placed of screens()) {
      const text = blockCenter(placed, isText);
      expect([text.x / placed.artboard.width, text.y / placed.artboard.height])
        .toEqual(CENTERS.top.text.map((c) => expect.closeTo(c, 6)));
    }
  });
});
