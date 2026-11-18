// SPDX-License-Identifier: Apache-2.0
import type { GroupElement, LeafElement, NativeInsets, Screen, ScreenshotElement } from "./schema.js";

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Source size left after a `native` screenshot's edge insets. */
export function nativeCroppedSize(
  image: { width: number; height: number },
  insets?: NativeInsets,
): { width: number; height: number } {
  return {
    width: Math.max(0, image.width - (insets?.left ?? 0) - (insets?.right ?? 0)),
    height: Math.max(0, image.height - (insets?.top ?? 0) - (insets?.bottom ?? 0)),
  };
}

/**
 * Region of a `native` screenshot's source drawn at its box's top-left, in source pixels. The
 * renderer draws it at the same size, and the export check compares exactly this region.
 */
export function nativeSourceRect(
  image: { width: number; height: number },
  box: { width: number; height: number },
  insets?: NativeInsets,
): PixelRect {
  const cropped = nativeCroppedSize(image, insets);
  return {
    x: insets?.left ?? 0,
    y: insets?.top ?? 0,
    width: Math.min(cropped.width, Math.floor(box.width)),
    height: Math.min(cropped.height, Math.floor(box.height)),
  };
}

export interface NativePlacement {
  element: ScreenshotElement;
  /** Box origin on the artboard (group offset applied). */
  x: number;
  y: number;
  /** Rotation and opacity the renderer composes from the layer and its group. */
  rotations: number[];
  opacities: number[];
  /** Visible leaves drawn after this one, in artboard coordinates. */
  above: PixelRect[];
}

/** Visible `native` screenshots of one screen, with what the renderer composes onto them. */
export function nativePlacements(screen: Screen): NativePlacement[] {
  const drawn: Array<{ leaf: LeafElement; rect: PixelRect; group?: GroupElement }> = [];
  for (const element of screen.elements) {
    if (!element.visible) continue;
    if (element.type === "group") {
      for (const child of element.children) {
        if (!child.visible) continue;
        drawn.push({
          leaf: child,
          group: element,
          rect: { x: element.x + child.x, y: element.y + child.y, width: child.width, height: child.height },
        });
      }
    } else {
      drawn.push({ leaf: element, rect: { x: element.x, y: element.y, width: element.width, height: element.height } });
    }
  }
  return drawn.flatMap(({ leaf, rect, group }, index): NativePlacement[] =>
    leaf.type === "screenshot" && leaf.fit === "native"
      ? [{
        element: leaf,
        x: rect.x,
        y: rect.y,
        rotations: [leaf.rotation, ...(group ? [group.rotation] : [])],
        opacities: [leaf.opacity, ...(group ? [group.opacity] : [])],
        above: drawn.slice(index + 1).map((entry) => entry.rect),
      }]
      : []);
}

export function rectsOverlap(a: PixelRect, b: PixelRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
