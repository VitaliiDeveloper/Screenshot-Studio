// SPDX-License-Identifier: Apache-2.0
import type { ImageElement, MediaCrop, ScreenshotElement } from "@screenshot-studio/core/model";

const DEFAULT_CROP = { x: 0.5, y: 0.5, zoom: 1 } as const;
const clampUnit = (value: number) => Math.min(1, Math.max(0, value));
const clampZoom = (value: number) => Math.min(4, Math.max(1, value));
const roundUnit = (value: number) => Number(clampUnit(value).toFixed(4));
const roundZoom = (value: number) => Number(clampZoom(value).toFixed(1));

export function cropFromPointer(
  pointer: { x: number; y: number },
  preview: { width: number; height: number },
  zoom: number,
): MediaCrop {
  return {
    x: roundUnit(pointer.x / preview.width),
    y: roundUnit(pointer.y / preview.height),
    zoom: roundZoom(zoom),
  };
}

export function nudgeCrop(
  crop: MediaCrop,
  key: string,
  largeStep: boolean,
): MediaCrop {
  const step = largeStep ? 0.1 : 0.01;
  if (key === "ArrowLeft") return { ...crop, x: roundUnit(crop.x - step) };
  if (key === "ArrowRight") return { ...crop, x: roundUnit(crop.x + step) };
  if (key === "ArrowUp") return { ...crop, y: roundUnit(crop.y - step) };
  if (key === "ArrowDown") return { ...crop, y: roundUnit(crop.y + step) };
  return crop;
}

export function adjustCropZoom(crop: MediaCrop, delta: number): MediaCrop {
  return { ...crop, zoom: roundZoom(crop.zoom + delta) };
}

export function mediaInspectorModel(element: ScreenshotElement | ImageElement) {
  return {
    crop: element.crop ?? DEFAULT_CROP,
    showCrop: element.fit === "cover",
    canResetCrop: element.fit === "cover" && Boolean(element.crop),
  };
}
