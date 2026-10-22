// SPDX-License-Identifier: Apache-2.0
import {
  fitElementsToArtboard,
  rotatedElementBounds,
  type Element,
  type Screen,
} from "@screenshot-studio/core/model";

export type TextPlacement = "top" | "bottom" | "side";

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the text and the media blocks go, as fractions of the artboard. */
const REGIONS: Record<TextPlacement, { text: Region; media: Region }> = {
  top: {
    text: { x: 0.08, y: 0.04, width: 0.84, height: 0.28 },
    media: { x: 0.08, y: 0.35, width: 0.84, height: 0.6 },
  },
  bottom: {
    media: { x: 0.08, y: 0.05, width: 0.84, height: 0.6 },
    text: { x: 0.08, y: 0.68, width: 0.84, height: 0.28 },
  },
  side: {
    text: { x: 0.07, y: 0.08, width: 0.44, height: 0.84 },
    media: { x: 0.56, y: 0.08, width: 0.38, height: 0.84 },
  },
};

function isMovable(element: Element): boolean {
  return element.visible && !element.locked;
}

function isText(element: Element): boolean {
  return element.type === "text";
}

function isMedia(element: Element): boolean {
  return element.type === "screenshot" || element.type === "image" || element.type === "device-frame";
}

/** Whether a placement has anything to move: an unlocked, visible text layer. */
export function hasPlaceableText(screen: Screen): boolean {
  return screen.elements.some((element) => isText(element) && isMovable(element));
}

/**
 * Fit a block of layers into a region, keeping its arrangement: centered, and scaled down
 * uniformly (never up) only when it is larger than the region.
 */
function fitBlock(elements: readonly Element[], region: Region): Element[] {
  if (elements.length === 0) return [];
  const bounds = elements.map(rotatedElementBounds);
  const minX = Math.min(...bounds.map((bound) => bound.minX));
  const minY = Math.min(...bounds.map((bound) => bound.minY));
  const size = {
    width: Math.max(...bounds.map((bound) => bound.maxX)) - minX,
    height: Math.max(...bounds.map((bound) => bound.maxY)) - minY,
  };
  const box = { width: Math.min(size.width, region.width), height: Math.min(size.height, region.height) };
  const fitted = fitElementsToArtboard(
    elements.map((element) => ({ ...element, x: element.x - minX, y: element.y - minY })),
    size,
    box,
  );
  return fitted.map((element) => ({
    ...element,
    x: element.x + region.x + (region.width - box.width) / 2,
    y: element.y + region.y + (region.height - box.height) / 2,
  }));
}

/**
 * One-time Text placement: writes literal positions (and the scale-down a block needs to fit) for
 * the screen's text layers and its screenshot, image and device-frame layers. Hidden and locked
 * layers, groups, and shapes stay put. Side puts the text on the start edge of the screen's
 * direction. Nothing about the preset is stored on the screen; without a text layer it returns
 * the same screen.
 */
export function placeScreenText(screen: Screen, placement: TextPlacement): Screen {
  if (!hasPlaceableText(screen)) return screen;
  const { width, height } = screen.artboard;
  const region = (unit: Region): Region => ({
    x: (screen.direction === "rtl" ? 1 - unit.x - unit.width : unit.x) * width,
    y: unit.y * height,
    width: unit.width * width,
    height: unit.height * height,
  });
  const regions = REGIONS[placement];
  const movable = screen.elements.filter(isMovable);
  const placed = new Map([
    ...fitBlock(movable.filter(isText), region(regions.text)),
    ...fitBlock(movable.filter(isMedia), region(regions.media)),
  ].map((element) => [element.id, element]));
  return { ...screen, elements: screen.elements.map((element) => placed.get(element.id) ?? element) };
}
