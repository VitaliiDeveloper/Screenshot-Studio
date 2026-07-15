// SPDX-License-Identifier: Apache-2.0
import { assertNever } from "./assert-never.js";
import {
  LeafElement as LeafElementSchema,
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

/** Bake one positive uniform scale into leaf geometry and every pixel-valued visual metric. */
export function scaleLeafElement<T extends LeafElement>(
  leaf: T,
  scale: number,
  offsetX = 0,
  offsetY = 0,
): T {
  const factor = Math.abs(scale);
  const transform = {
    x: leaf.x * factor + offsetX,
    y: leaf.y * factor + offsetY,
    width: leaf.width * factor,
    height: leaf.height * factor,
  };

  let scaled: LeafElement;
  switch (leaf.type) {
    case "text":
      scaled = {
        ...leaf,
        ...transform,
        size: leaf.size * factor,
        letterSpacing: leaf.letterSpacing * factor,
        ...(leaf.shadow ? {
          shadow: {
            ...leaf.shadow,
            blur: scaleBoundedVisualMetric(
              leaf.shadow.blur,
              factor,
              TEXT_SHADOW_BLUR_MAX,
              "text shadow blur",
              leaf.id,
            ),
            offsetX: leaf.shadow.offsetX * factor,
            offsetY: leaf.shadow.offsetY * factor,
          },
        } : {}),
      };
      break;
    case "shape":
      scaled = {
        ...leaf,
        ...transform,
        radius: leaf.radius * factor,
        ...(leaf.stroke ? {
          stroke: {
            ...leaf.stroke,
            width: scaleBoundedVisualMetric(
              leaf.stroke.width,
              factor,
              SHAPE_STROKE_WIDTH_MAX,
              "shape stroke width",
              leaf.id,
            ),
          },
        } : {}),
      };
      break;
    case "screenshot":
    case "image":
      scaled = { ...leaf, ...transform, cornerRadius: leaf.cornerRadius * factor };
      break;
    case "icon":
      scaled = { ...leaf, ...transform, strokeWidth: leaf.strokeWidth * factor };
      break;
    case "device-frame":
      scaled = { ...leaf, ...transform };
      break;
    default:
      return assertNever(leaf);
  }

  const parsed = LeafElementSchema.safeParse(scaled);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".") || "element";
    throw new Error(
      `Cannot scale element "${leaf.id}" within strict schema v1: ${field}: ${issue?.message ?? "invalid value"}`,
      { cause: parsed.error },
    );
  }
  return parsed.data as T;
}
