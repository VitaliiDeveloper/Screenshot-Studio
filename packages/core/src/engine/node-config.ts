import type Konva from "konva";
import type { Element } from "../model/schema.js";

/**
 * The single element→Konva-props map (docs/specs/2026-07-04-phase1-slice1-interactive-canvas-design.md
 * §1): both the static export renderer (`renderScreen`) and the interactive editor stage build nodes
 * from this exact output, so UI and CLI can never render an element two different ways. Pure and
 * side-effect free — it maps document props to visual props only. Interaction props (draggable,
 * listeners) are the editor's concern and are added by the caller, never here, so the export config
 * stays identical.
 */
export type NodeConfig =
  | { konva: "Text"; config: Konva.TextConfig }
  | { konva: "Rect"; config: Konva.RectConfig };

export function elementToNodeConfig(element: Element): NodeConfig {
  const common = {
    id: element.id,
    x: element.x,
    y: element.y,
    rotation: element.rotation,
    opacity: element.opacity,
  };

  if (element.type === "text") {
    return {
      konva: "Text",
      config: {
        ...common,
        width: element.width,
        height: element.height,
        text: element.content,
        fontFamily: element.fontFamily,
        fontSize: element.size,
        // Konva folds fontStyle into the canvas font shorthand; a numeric weight string
        // ("600 96px Family") is valid CSS, so this maps custom weights directly.
        fontStyle: String(element.weight),
        lineHeight: element.lineHeight,
        letterSpacing: element.letterSpacing,
        align: element.align,
        fill: element.color,
      },
    };
  }

  return {
    konva: "Rect",
    config: {
      ...common,
      width: element.width,
      height: element.height,
      fill: element.fill,
      cornerRadius: element.radius,
    },
  };
}
