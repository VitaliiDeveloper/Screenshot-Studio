// SPDX-License-Identifier: Apache-2.0
/** Human-readable fallback labels for the layers panel (name overrides these). */
const TYPE_LABELS: Record<string, string> = {
  text: "Text",
  shape: "Shape",
  screenshot: "Screenshot",
  "device-frame": "Device frame",
  icon: "Icon",
  badge: "Badge",
  image: "Image",
};

/** The row label for a layer: its name if set, otherwise a human type label. */
export function elementLabel(el: { type: string; name?: string }): string {
  const trimmed = el.name?.trim();
  return trimmed ? trimmed : (TYPE_LABELS[el.type] ?? el.type);
}

/**
 * The layers list renders reversed — top-of-list is the front-most element, i.e. the LAST item
 * in `screen.elements`. This maps a visible-row index back to its `elements` array index.
 */
export function viewToArrayIndex(len: number, viewIndex: number): number {
  return len - 1 - viewIndex;
}
