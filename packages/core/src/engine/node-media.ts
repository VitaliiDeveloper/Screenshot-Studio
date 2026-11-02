// SPDX-License-Identifier: Apache-2.0
import type { MediaCrop } from "@screenshot-studio/core/model";
import type { Box, NodeFilter } from "./node-types.js";

interface Fit {
  x: number;
  y: number;
  width: number;
  height: number;
  cropX?: number;
  cropY?: number;
  cropWidth?: number;
  cropHeight?: number;
}

export function mediaFilter(blur: number | undefined): NodeFilter | undefined {
  return blur && blur > 0 ? { kind: "blur", radius: blur } : undefined;
}

/**
 * object-fit for a decoded image inside a box, RELATIVE to the box's (0,0). Shared by `screenshot`
 * (box = the element) and `device-frame` (box = the screen slot). Pure.
 */
export function computeImageFit(
  image: HTMLImageElement,
  box: Box,
  fit: "cover" | "contain",
  crop?: MediaCrop,
): Fit {
  if (fit === "contain") {
    const scale = Math.min(box.width / image.width, box.height / image.height);
    const drawW = image.width * scale;
    const drawH = image.height * scale;
    return { x: (box.width - drawW) / 2, y: (box.height - drawH) / 2, width: drawW, height: drawH };
  }
  // cover: fill the box, crop the overflow (Konva object-fit-cover recipe, centred).
  const boxRatio = box.width / box.height;
  const imgRatio = image.width / image.height;
  let cropWidth: number;
  let cropHeight: number;
  if (boxRatio >= imgRatio) {
    cropWidth = image.width;
    cropHeight = image.width / boxRatio;
  } else {
    cropWidth = image.height * boxRatio;
    cropHeight = image.height;
  }
  const zoom = crop?.zoom ?? 1;
  cropWidth /= zoom;
  cropHeight /= zoom;
  const focalX = (crop?.x ?? 0.5) * image.width;
  const focalY = (crop?.y ?? 0.5) * image.height;
  const cropX = Math.min(image.width - cropWidth, Math.max(0, focalX - cropWidth / 2));
  const cropY = Math.min(image.height - cropHeight, Math.max(0, focalY - cropHeight / 2));
  return {
    x: 0,
    y: 0,
    width: box.width,
    height: box.height,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
  };
}
