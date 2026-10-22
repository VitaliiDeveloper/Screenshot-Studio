// SPDX-License-Identifier: Apache-2.0
import {
  fitElementsToArtboard,
  rotatedElementBounds,
  type Element,
  type Screen,
} from "@screenshot-studio/core/model";
import { isScaleRangeError } from "./editor-apply-scope.js";

export type TextPlacement = "top" | "bottom" | "side";

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the text stack and the media block go, as fractions of the artboard. */
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

// Applying a preset again moves nothing; drift below this is float noise, not a change.
const EPSILON = 1e-6;

function isMovable(element: Element): boolean {
  return element.visible && !element.locked;
}

function isText(element: Element): boolean {
  return element.type === "text";
}

function isMedia(element: Element): boolean {
  return element.type === "screenshot" || element.type === "device-frame";
}

/** Whether a placement has anything to move: a visible, unlocked text layer. */
export function hasPlaceableText(screen: Screen): boolean {
  return screen.elements.some((element) => isText(element) && isMovable(element));
}

/**
 * Text layers take the region's width and stack in their current top-to-bottom order, centered
 * vertically. Size and box height stay, so text reflows and Issues reports any overflow.
 */
function stackText(elements: readonly Element[], region: Region): Element[] {
  const ordered = [...elements].sort((first, second) => first.y - second.y);
  const stackHeight = ordered.reduce((sum, element) => sum + element.height, 0);
  let y = region.y + Math.max(0, (region.height - stackHeight) / 2);
  return ordered.map((element) => {
    const placed = { ...element, x: region.x, y, width: region.width };
    y += element.height;
    return placed;
  });
}

/**
 * Fit a block of media layers into a region, keeping its arrangement and aspect ratio: scaled to
 * touch the region in one direction and centered. A block whose blur cannot scale that far keeps
 * its size and is only centered.
 */
function fitMedia(elements: readonly Element[], region: Region): Element[] {
  if (elements.length === 0) return [];
  const bounds = elements.map(rotatedElementBounds);
  const minX = Math.min(...bounds.map((bound) => bound.minX));
  const minY = Math.min(...bounds.map((bound) => bound.minY));
  const size = {
    width: Math.max(...bounds.map((bound) => bound.maxX)) - minX,
    height: Math.max(...bounds.map((bound) => bound.maxY)) - minY,
  };
  const origin = elements.map((element) => ({ ...element, x: element.x - minX, y: element.y - minY }));
  let box = { width: region.width, height: region.height };
  let fitted: Element[];
  try {
    fitted = fitElementsToArtboard(origin, size, box);
  } catch (error) {
    if (!isScaleRangeError(error)) throw error;
    box = size;
    fitted = fitElementsToArtboard(origin, size, box);
  }
  return fitted.map((element) => ({
    ...element,
    x: element.x + region.x + (region.width - box.width) / 2,
    y: element.y + region.y + (region.height - box.height) / 2,
  }));
}

function sameBox(first: Element, second: Element): boolean {
  return (["x", "y", "width", "height"] as const).every((key) => Math.abs(first[key] - second[key]) < EPSILON);
}

/**
 * One-time Text placement: writes literal positions for the screen's text layers and fits its
 * screenshot and device-frame layers beside them. Hidden and locked layers, images, shapes, and
 * groups stay put. Side puts the text on the start edge of the screen's direction. Nothing about
 * the preset is stored on the screen; the same screen comes back when there is no text layer or
 * nothing would move.
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
    ...stackText(movable.filter(isText), region(regions.text)),
    ...fitMedia(movable.filter(isMedia), region(regions.media)),
  ].map((element) => [element.id, element]));
  const elements = screen.elements.map((element) => placed.get(element.id) ?? element);
  return elements.every((element, index) => sameBox(element, screen.elements[index]!))
    ? screen
    : { ...screen, elements };
}
