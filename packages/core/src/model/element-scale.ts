// SPDX-License-Identifier: Apache-2.0
import { LeafElement as LeafElementSchema, type LeafElement } from "./schema.js";

/** Scale every persisted render-bearing leaf field through one positive geometry transform. */
export function scaleLeafElement<T extends LeafElement>(
  leaf: T,
  scale: number,
  offset: { x?: number; y?: number } = {},
): T {
  const factor = Math.abs(scale);
  const scaled = {
    ...leaf,
    x: leaf.x * factor + (offset.x ?? 0),
    y: leaf.y * factor + (offset.y ?? 0),
    width: leaf.width * factor,
    height: leaf.height * factor,
    ...(leaf.type === "text" ? {
      size: leaf.size * factor,
      letterSpacing: leaf.letterSpacing * factor,
      ...(leaf.shadow ? {
        shadow: {
          ...leaf.shadow,
          blur: leaf.shadow.blur * factor,
          offsetX: leaf.shadow.offsetX * factor,
          offsetY: leaf.shadow.offsetY * factor,
        },
      } : {}),
    } : {}),
    ...(leaf.type === "shape" ? {
      radius: leaf.radius * factor,
      ...(leaf.stroke ? { stroke: { ...leaf.stroke, width: leaf.stroke.width * factor } } : {}),
    } : {}),
    ...(leaf.type === "icon" ? { strokeWidth: leaf.strokeWidth * factor } : {}),
    ...(leaf.type === "screenshot" || leaf.type === "image"
      ? { cornerRadius: leaf.cornerRadius * factor }
      : {}),
  };
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
