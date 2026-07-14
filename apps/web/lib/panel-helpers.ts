// SPDX-License-Identifier: Apache-2.0
import type { Element } from "@screenshot-studio/core/model";

/** Human-readable fallback labels for the layers panel (name overrides these). */
const TYPE_LABELS = {
  text: "Text",
  shape: "Shape",
  screenshot: "Screenshot",
  "device-frame": "Device frame",
  group: "Group",
  icon: "Icon",
  image: "Image",
} satisfies Record<Element["type"], string>;

/** The row label for a layer: its name if set, otherwise a human type label. */
export function elementLabel(el: Pick<Element, "type" | "name">): string {
  const trimmed = el.name?.trim();
  return trimmed ? trimmed : TYPE_LABELS[el.type];
}

/**
 * The layers list renders reversed — top-of-list is the front-most element, i.e. the LAST item
 * in `screen.elements`. This maps a visible-row index back to its `elements` array index.
 */
export function viewToArrayIndex(len: number, viewIndex: number): number {
  return len - 1 - viewIndex;
}
