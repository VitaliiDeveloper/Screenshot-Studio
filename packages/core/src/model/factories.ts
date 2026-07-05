import type { TextElement, ShapeElement } from "./schema.js";

/** Optional top-left origin for a newly inserted element (defaults to a fixed offset). */
export interface ElementOrigin {
  x?: number;
  y?: number;
}

/**
 * Schema-valid default elements for insert-on-click (spec §"core — insert factories"). Every
 * required field with no Zod default is set explicitly. Lives in `core`, not the toolbar, so a
 * future CLI `element add` shares the exact same defaults (DRY).
 */
export function createTextElement(origin: ElementOrigin = {}): TextElement {
  return {
    id: crypto.randomUUID(),
    type: "text",
    x: origin.x ?? 100,
    y: origin.y ?? 100,
    width: 400,
    height: 120,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    content: "Text",
    fontFamily: "sans-serif",
    size: 64,
    weight: 400,
    lineHeight: 1.2,
    letterSpacing: 0,
    align: "left",
    color: "#000000",
  };
}

export function createShapeElement(origin: ElementOrigin = {}): ShapeElement {
  return {
    id: crypto.randomUUID(),
    type: "shape",
    x: origin.x ?? 100,
    y: origin.y ?? 100,
    width: 300,
    height: 300,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    kind: "rect",
    fill: "#3B82F6",
    radius: 0,
  };
}
