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

/** The human label for a layer type, e.g. "Device frame". */
export function elementTypeLabel(type: Element["type"]): string {
  return TYPE_LABELS[type];
}

/** Secondary line of a screen row in the Screens → Layers tree. */
export function screenTreeSummary(layerCount: number, selectedCount: number): string {
  const layers = `${layerCount} layer${layerCount === 1 ? "" : "s"}`;
  return selectedCount > 0 ? `${layers} · ${selectedCount} selected` : layers;
}

/** One entry of a selection type breakdown, e.g. "2 text". */
export function typeCountLabel(type: Element["type"], count: number): string {
  return `${count} ${TYPE_LABELS[type].toLowerCase()}`;
}

/** Type breakdown of a multi-layer selection in first-seen order, e.g. "2 text · 1 shape". */
export function selectionTypeSummary(elements: readonly Pick<Element, "type">[]): string {
  const counts = new Map<Element["type"], number>();
  for (const { type } of elements) counts.set(type, (counts.get(type) ?? 0) + 1);
  return [...counts].map(([type, count]) => typeCountLabel(type, count)).join(" · ");
}

/**
 * The layers list renders reversed — top-of-list is the front-most element, i.e. the LAST item
 * in `screen.elements`. This maps a visible-row index back to its `elements` array index.
 */
export function viewToArrayIndex(len: number, viewIndex: number): number {
  return len - 1 - viewIndex;
}
