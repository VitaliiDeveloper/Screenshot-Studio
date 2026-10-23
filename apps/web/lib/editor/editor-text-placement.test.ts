// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_STORE_SPECS, findStoreTarget } from "@screenshot-studio/core/export";
import {
  MEDIA_BLUR_MAX,
  createImageElement,
  createScreenshotElement,
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

const rounded = (screen: Screen): Screen => JSON.parse(JSON.stringify(
  screen,
  (_key, value) => typeof value === "number" ? Math.round(value * 1e6) / 1e6 : value,
));
const byId = (screen: Screen, id: string) => screen.elements.find((element) => element.id === id)!;

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

  it.each(["top", "bottom", "side"] as const)("%s fits the media into its region and keeps text sizes", (placement) => {
    const original = byId(screen, "mockup");
    const placed = placeScreenText(screen, placement);
    const mockup = byId(placed, "mockup");
    const [regionWidth, regionHeight] = placement === "side"
      ? [0.38 * width, 0.84 * height]
      : [0.84 * width, 0.6 * height];

    expect(mockup.width / mockup.height).toBeCloseTo(original.width / original.height, 6);
    expect(Math.max(mockup.width / regionWidth, mockup.height / regionHeight)).toBeCloseTo(1, 6);
    for (const id of ["headline", "subtitle"]) {
      expect(byId(placed, id)).toMatchObject({
        size: (byId(screen, id) as Extract<Element, { type: "text" }>).size,
        height: byId(screen, id).height,
      });
    }
  });

  it("stacks the text layers at the region width in their current order", () => {
    const placed = placeScreenText(screen, "top");

    expect(byId(placed, "headline")).toMatchObject({ x: 0.08 * width, width: 0.84 * width });
    expect(byId(placed, "subtitle")).toMatchObject({ x: 0.08 * width, width: 0.84 * width });
    expect(byId(placed, "subtitle").y).toBeCloseTo(byId(placed, "headline").y + byId(placed, "headline").height, 6);
  });

  it("gives the same result whichever preset was applied before", () => {
    const afterSide = placeScreenText(placeScreenText(screen, "side"), "top");

    expect(rounded(afterSide)).toEqual(rounded(placeScreenText(screen, "top")));
  });

  it("returns the same screen when the preset is applied again", () => {
    const placed = placeScreenText(screen, "bottom");

    expect(placeScreenText(placed, "bottom")).toBe(placed);
  });
});

describe("text placement rules", () => {
  it("puts Side text on the start edge of a right-to-left screen", () => {
    const screen = templateScreen("iphone-starter", "rtl");
    const placed = placeScreenText(screen, "side");

    expect(blockCenter(placed, isText).x / screen.artboard.width).toBeCloseTo(0.71, 6);
    expect(blockCenter(placed, isMockup).x / screen.artboard.width).toBeCloseTo(0.25, 6);
  });

  it("leaves hidden, locked, image and shape layers where they are", () => {
    const screen = templateScreen("iphone-starter");
    const logo = { ...createImageElement({ assetUrl: "assets/logo.png", x: 30, y: 40 }), id: "logo" };
    const marked: Element[] = [...screen.elements, logo].map((element) => element.id === "subtitle"
      ? { ...element, locked: true }
      : element.id === "mockup" ? { ...element, visible: false } : element);
    const placed = placeScreenText({ ...screen, elements: marked }, "bottom");

    for (const id of ["subtitle", "mockup", "accent", "logo"]) {
      expect(byId(placed, id)).toBe(marked.find((element) => element.id === id));
    }
    expect(byId(placed, "headline")).not.toBe(marked.find((element) => element.id === "headline"));
  });

  it("does not resize the headline because another text layer sits far from it", () => {
    const screen = templateScreen("iphone-starter");
    const caption = { ...createTextElement({ x: 100, y: screen.artboard.height - 200 }), id: "caption", width: 600, height: 80 };
    const placed = placeScreenText({ ...screen, elements: [...screen.elements, caption] }, "top");

    expect(byId(placed, "headline")).toMatchObject({ size: (byId(screen, "headline") as { size: number }).size });
    expect(byId(placed, "caption").y).toBeGreaterThan(byId(placed, "subtitle").y);
    expect(byId(placed, "headline").y / screen.artboard.height).toBeCloseTo(0.04, 6);
  });

  it("keeps a text stack taller than its region on the artboard", () => {
    const screen = templateScreen("iphone-starter");
    const { height } = screen.artboard;
    const tall = screen.elements.map((element) => element.type === "text" ? { ...element, height: 0.4 * height } : element);

    for (const placement of ["top", "bottom", "side"] as const) {
      const texts = placeScreenText({ ...screen, elements: tall }, placement).elements.filter(isText);
      expect(Math.min(...texts.map((element) => element.y))).toBeGreaterThanOrEqual(0);
      expect(Math.max(...texts.map((element) => element.y + element.height))).toBeLessThanOrEqual(height + 1e-6);
    }
  });

  it("keeps a media block's size when its blur cannot scale up to the region", () => {
    const screen = templateScreen("iphone-starter");
    const shot = { ...createScreenshotElement({ assetUrl: "assets/shot.png", x: 10, y: 20, width: 100, height: 200 }), id: "shot", blur: MEDIA_BLUR_MAX };
    const placed = placeScreenText({ ...screen, elements: [...screen.elements.filter((element) => element.id !== "mockup"), shot] }, "top");

    expect(byId(placed, "shot")).toMatchObject({ width: 100, height: 200, blur: MEDIA_BLUR_MAX });
    expect(blockCenter(placed, (element) => element.id === "shot").x / screen.artboard.width).toBeCloseTo(0.5, 6);
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

  it("records no further step when the same preset is applied again", () => {
    editorStore.getState().placeText("side");
    const past = editorStore.getState().historyPast.length;

    editorStore.getState().placeText("side");

    expect(editorStore.getState().historyPast).toHaveLength(past);
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
