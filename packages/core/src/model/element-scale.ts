// SPDX-License-Identifier: Apache-2.0
import { assertNever } from "./assert-never.js";
import {
  SHAPE_STROKE_WIDTH_MAX,
  TEXT_SHADOW_BLUR_MAX,
  type LeafElement,
} from "./schema.js";

function scaleBoundedVisualMetric(
  value: number,
  scale: number,
  maximum: number,
  label: string,
  elementId: string,
): number {
  const scaled = value * scale;
  if (scaled > maximum) {
    throw new Error(`Cannot scale ${label} above ${maximum} for element "${elementId}"`);
  }
  return scaled;
}

/** Bake one uniform scale into leaf geometry and every pixel-valued visual metric. */
export function scaleLeafElement(
  leaf: LeafElement,
  scale: number,
  offsetX = 0,
  offsetY = 0,
): LeafElement {
  const transform = {
    x: leaf.x * scale + offsetX,
    y: leaf.y * scale + offsetY,
    width: leaf.width * scale,
    height: leaf.height * scale,
  };

  switch (leaf.type) {
    case "text":
      return {
        ...leaf,
        ...transform,
        size: leaf.size * scale,
        letterSpacing: leaf.letterSpacing * scale,
        ...(leaf.shadow ? {
          shadow: {
            ...leaf.shadow,
            blur: scaleBoundedVisualMetric(
              leaf.shadow.blur,
              scale,
              TEXT_SHADOW_BLUR_MAX,
              "text shadow blur",
              leaf.id,
            ),
            offsetX: leaf.shadow.offsetX * scale,
            offsetY: leaf.shadow.offsetY * scale,
          },
        } : {}),
      };
    case "shape":
      return {
        ...leaf,
        ...transform,
        radius: leaf.radius * scale,
        ...(leaf.stroke ? {
          stroke: {
            ...leaf.stroke,
            width: scaleBoundedVisualMetric(
              leaf.stroke.width,
              scale,
              SHAPE_STROKE_WIDTH_MAX,
              "shape stroke width",
              leaf.id,
            ),
          },
        } : {}),
      };
    case "screenshot":
    case "image":
      return { ...leaf, ...transform, cornerRadius: leaf.cornerRadius * scale };
    case "icon":
      return { ...leaf, ...transform, strokeWidth: leaf.strokeWidth * scale };
    case "device-frame":
      return { ...leaf, ...transform };
    default:
      return assertNever(leaf);
  }
}
