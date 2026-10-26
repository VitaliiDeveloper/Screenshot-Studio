// SPDX-License-Identifier: Apache-2.0
import { clampZoom, MAX_ZOOM, MIN_ZOOM } from "@web/lib/editor/editor-workspace";

// Trackpad pinch arrives as ctrl+wheel with small deltas; a mouse notch reports ~100, so cap it.
const WHEEL_ZOOM_SENSITIVITY = 0.01;
const MAX_WHEEL_ZOOM_DELTA = 25;

export interface ClientPoint {
  x: number;
  y: number;
}

export function clientToViewportPoint(
  rect: DOMRectReadOnly,
  point: ClientPoint,
): ClientPoint {
  return { x: point.x - rect.left, y: point.y - rect.top };
}

export function nextAnchoredScroll(input: {
  scrollLeft: number;
  scrollTop: number;
  anchor: ClientPoint;
  previousZoom: number;
  nextZoom: number;
}): { scrollLeft: number; scrollTop: number } {
  const ratio = input.nextZoom / input.previousZoom;
  return {
    scrollLeft: (input.scrollLeft + input.anchor.x) * ratio - input.anchor.x,
    scrollTop: (input.scrollTop + input.anchor.y) * ratio - input.anchor.y,
  };
}

/**
 * Wheel zoom stays unrounded between events; clampZoom's 0.001 rounding would otherwise swallow
 * the small pinch steps at low zoom.
 */
export function nextWheelZoom(input: {
  zoom: number;
  unrounded: number | null;
  deltaY: number;
}): number {
  const base = input.unrounded !== null && clampZoom(input.unrounded) === input.zoom
    ? input.unrounded
    : input.zoom;
  const delta = Math.max(-MAX_WHEEL_ZOOM_DELTA, Math.min(MAX_WHEEL_ZOOM_DELTA, input.deltaY));
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, base * Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY)));
}

export function activeArtboardScrollBehavior(input: {
  leftInset: number;
  rightInset: number;
  reducedMotion: boolean;
}): ScrollBehavior {
  return input.reducedMotion || input.leftInset > 0 || input.rightInset > 0
    ? "auto"
    : "smooth";
}
