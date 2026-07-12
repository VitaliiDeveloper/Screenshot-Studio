// SPDX-License-Identifier: Apache-2.0
import type { Element } from "@screenshot-studio/core/model";

export function transformedDimensions(
  element: Element,
  scaleX: number,
  scaleY: number,
): { width: number; height: number } {
  if (element.type !== "group") {
    return {
      width: Math.max(5, element.width * scaleX),
      height: Math.max(5, element.height * scaleY),
    };
  }
  const scale = Math.max(
    5 / element.width,
    5 / element.height,
    (Math.abs(scaleX) + Math.abs(scaleY)) / 2,
  );
  return { width: element.width * scale, height: element.height * scale };
}
