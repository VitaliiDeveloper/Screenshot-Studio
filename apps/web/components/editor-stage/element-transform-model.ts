// SPDX-License-Identifier: Apache-2.0
import { deviceFramePreset, type Element } from "@screenshot-studio/core/model";

const MIN_ELEMENT_SIZE = 5;

export function elementKeepsAspectRatio(element: Element | undefined): boolean {
  return element?.type === "group" || element?.type === "device-frame";
}

export function transformedDimensions(
  element: Element,
  scaleX: number,
  scaleY: number,
): { width: number; height: number } {
  if (!elementKeepsAspectRatio(element)) {
    return {
      width: Math.max(MIN_ELEMENT_SIZE, element.width * Math.abs(scaleX)),
      height: Math.max(MIN_ELEMENT_SIZE, element.height * Math.abs(scaleY)),
    };
  }
  const requestedScale = (Math.abs(scaleX) + Math.abs(scaleY)) / 2;
  if (element.type === "device-frame") {
    const aspectRatio = deviceFramePreset(element.deviceType).recipe.spec.aspectRatio;
    const width = Math.max(
      MIN_ELEMENT_SIZE,
      MIN_ELEMENT_SIZE * aspectRatio,
      element.width * requestedScale,
    );
    return {
      width,
      height: width / aspectRatio,
    };
  }
  const scale = Math.max(
    MIN_ELEMENT_SIZE / element.width,
    MIN_ELEMENT_SIZE / element.height,
    requestedScale,
  );
  const width = element.width * scale;
  return { width, height: element.height * scale };
}
