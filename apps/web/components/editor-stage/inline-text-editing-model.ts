// SPDX-License-Identifier: Apache-2.0
import type { CSSProperties } from "react";
import type { LayoutDirection, TextElement } from "@screenshot-studio/core/model";

export interface InlineTextStyleInput {
  element: TextElement;
  projection: { x: number; y: number; direction: LayoutDirection };
  baseX: number;
  zoom: number;
}

export function deriveInlineTextStyle({
  element,
  projection,
  baseX,
  zoom,
}: InlineTextStyleInput): CSSProperties {
  return {
    left: (projection.x + baseX + element.x) * zoom,
    top: (projection.y + element.y) * zoom,
    width: element.width * zoom,
    height: element.height * zoom,
    transform: `rotate(${element.rotation}deg)`,
    transformOrigin: "top left",
    fontFamily: `"${element.fontFamily}"`,
    fontSize: element.size * zoom,
    fontWeight: element.weight,
    lineHeight: element.lineHeight,
    letterSpacing: element.letterSpacing * zoom,
    textAlign: element.align,
    direction: projection.direction,
    color: element.color,
    opacity: element.opacity,
  };
}
