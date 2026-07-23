// SPDX-License-Identifier: Apache-2.0
import type { ImageElement, ScreenshotElement } from "@screenshot-studio/core/model";

const DEFAULT_CROP = { x: 0.5, y: 0.5, zoom: 1 } as const;

export function mediaInspectorModel(element: ScreenshotElement | ImageElement) {
  return {
    crop: element.crop ?? DEFAULT_CROP,
    showCrop: element.fit === "cover",
    canResetCrop: element.fit === "cover" && Boolean(element.crop),
  };
}
