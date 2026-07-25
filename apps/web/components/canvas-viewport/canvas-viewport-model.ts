// SPDX-License-Identifier: Apache-2.0

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

export function activeArtboardScrollBehavior(input: {
  leftInset: number;
  rightInset: number;
  reducedMotion: boolean;
}): ScrollBehavior {
  return input.reducedMotion || input.leftInset > 0 || input.rightInset > 0
    ? "auto"
    : "smooth";
}
