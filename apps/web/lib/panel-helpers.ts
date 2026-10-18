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

const TEXT_PREVIEW_LENGTH = 30;

type LabelledElement = Pick<Element, "type" | "name"> & { content?: string };

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const flatText = (content: string) => content.replace(/\s+/g, " ").trim();

/** A text layer's content on one line, cut to ~30 characters with "…"; "" when blank. */
export function textPreview(content: string): string {
  const flat = flatText(content);
  const chars = Array.from(graphemes.segment(flat), ({ segment }) => segment);
  return chars.length > TEXT_PREVIEW_LENGTH
    ? `${chars.slice(0, TEXT_PREVIEW_LENGTH).join("").trimEnd()}…`
    : flat;
}

/** The row label for a layer: its name, else an unnamed text layer's text, else a human type label. */
export function elementLabel(el: LabelledElement): string {
  return el.name?.trim() || (el.type === "text" ? textPreview(el.content ?? "") : "") || TYPE_LABELS[el.type];
}

/** A text layer's full text on one line when its label does not already show it all, else null. */
export function elementTextDescription(el: LabelledElement): string | null {
  const text = el.type === "text" ? flatText(el.content ?? "") : "";
  return text && text.toLowerCase() !== elementLabel(el).toLowerCase() ? text : null;
}

/** The human label for a layer type, e.g. "Device frame". */
export function elementTypeLabel(type: Element["type"]): string {
  return TYPE_LABELS[type];
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Secondary line of a screen row in Focus; the selected count appears only for a multi-selection. */
export function screenTreeSummary(layerCount: number, selectedCount: number): string {
  const layers = countLabel(layerCount, "layer");
  return selectedCount > 1 ? `${layers} · ${selectedCount} selected` : layers;
}

/** "1 size" / "4 sizes": a screen row in Overview and the Overview Screens header. */
export function sizeCountLabel(count: number): string {
  return countLabel(count, "size");
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
