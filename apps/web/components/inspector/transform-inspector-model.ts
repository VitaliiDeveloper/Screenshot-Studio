// SPDX-License-Identifier: Apache-2.0
import type { Element } from "@screenshot-studio/core/model";
import type { CommonElementPatch } from "@web/lib/editor-element-patch";

type ElementType = Element["type"];

export function directTransformPatch(
  locked: boolean,
  patch: CommonElementPatch,
): CommonElementPatch | null {
  return locked ? null : patch;
}

export function linkedSizePatch(
  current: { width: number; height: number },
  axis: "width" | "height",
  next: number,
  locked: boolean,
): Pick<CommonElementPatch, "width" | "height"> {
  if (!locked) return axis === "width" ? { width: next } : { height: next };
  const ratio = current.width / current.height;
  return axis === "width"
    ? { width: next, height: next / ratio }
    : { width: next * ratio, height: next };
}

export function positionFromMiniPointer({
  pointer,
  preview,
  artboard,
  element,
}: {
  pointer: { x: number; y: number };
  preview: { width: number; height: number };
  artboard: { width: number; height: number };
  element: { width: number; height: number };
}): Pick<CommonElementPatch, "x" | "y"> {
  const pointerX = Math.min(preview.width, Math.max(0, pointer.x));
  const pointerY = Math.min(preview.height, Math.max(0, pointer.y));
  return {
    x: (pointerX / preview.width) * artboard.width - element.width / 2,
    y: (pointerY / preview.height) * artboard.height - element.height / 2,
  };
}

export function rotationFromPointer(
  pointer: { x: number; y: number },
  center: { x: number; y: number },
): number {
  const raw = Math.round(Math.atan2(pointer.y - center.y, pointer.x - center.x) * (180 / Math.PI) + 90);
  return normalizeRotation(raw);
}

export function normalizeRotation(value: number): number {
  const normalized = ((value % 360) + 360) % 360;
  return normalized === 0 && value > 0 ? 360 : normalized;
}

export function defaultAspectRatioLocked(type: ElementType): boolean {
  return type === "screenshot" || type === "image" || aspectRatioLockForced(type);
}

export function aspectRatioLockForced(type: ElementType): boolean {
  return type === "group" || type === "device-frame";
}
