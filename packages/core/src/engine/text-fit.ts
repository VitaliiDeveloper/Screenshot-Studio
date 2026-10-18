// SPDX-License-Identifier: Apache-2.0
import Konva from "konva";
import type { LayoutDirection, TextElement } from "@screenshot-studio/core/model";
import { elementToNodeConfig } from "./node-config.js";

function textNodeConfig(element: TextElement, direction: LayoutDirection): Konva.TextConfig {
  const node = elementToNodeConfig(element, { direction });
  if (node.konva !== "Text") throw new Error(`Element "${element.id}" is not rendered as text`);
  return node.config;
}

/**
 * Whether a text layer's content spills out of its box, measured with the exact Konva.Text config
 * the editor and export draw. With a fixed height Konva keeps the first line and silently drops
 * every later line that would cross the box, so text overflows when lines are dropped or a single
 * line is already taller than the box. Browser-only: Konva measures glyphs on a canvas context.
 */
export function textOverflows(element: TextElement, direction: LayoutDirection = "ltr"): boolean {
  const config = textNodeConfig(element, direction);
  const boxed = new Konva.Text(config);
  const unbounded = new Konva.Text({ ...config, height: undefined });
  const lineHeightPx = boxed.lineHeight() * boxed.fontSize();
  return unbounded.textArr.length > boxed.textArr.length || lineHeightPx > boxed.height();
}

/** Height the content lays out to without the box's height limit, from the same Konva.Text config. */
export function textContentHeight(element: TextElement, direction: LayoutDirection = "ltr"): number {
  return new Konva.Text({ ...textNodeConfig(element, direction), height: undefined }).height();
}

/**
 * Largest whole size in `[1, max]` that `fits`, or null when even 1 does not.
 * shortcut: assumes fitting is monotonic in size; word wrapping can rarely break that, so a
 * non-monotonic box may get a slightly smaller size than the true maximum.
 */
export function largestFittingSize(max: number, fits: (size: number) => boolean): number | null {
  let low = 1;
  let high = Math.floor(max);
  let best: number | null = null;
  while (low <= high) {
    const size = Math.floor((low + high) / 2);
    if (fits(size)) {
      best = size;
      low = size + 1;
    } else {
      high = size - 1;
    }
  }
  return best;
}

/** "Fit text": the largest whole font size, at most the current one, that stays inside the box. */
export function fitTextSize(element: TextElement, direction: LayoutDirection = "ltr"): number | null {
  return largestFittingSize(element.size, (size) => !textOverflows({ ...element, size }, direction));
}
