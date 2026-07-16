// SPDX-License-Identifier: Apache-2.0
import type { Element } from "@screenshot-studio/core/model";

const MIN_ELEMENT_SIZE = 5;

export function transformedDimensions(
  element: Element,
  scaleX: number,
  scaleY: number,
): { width: number; height: number } {
  if (element.type !== "group") {
    return {
      width: Math.max(MIN_ELEMENT_SIZE, element.width * Math.abs(scaleX)),
      height: Math.max(MIN_ELEMENT_SIZE, element.height * Math.abs(scaleY)),
    };
  }
  const scale = Math.max(
    MIN_ELEMENT_SIZE / element.width,
    MIN_ELEMENT_SIZE / element.height,
    (Math.abs(scaleX) + Math.abs(scaleY)) / 2,
  );
  return { width: element.width * scale, height: element.height * scale };
}
