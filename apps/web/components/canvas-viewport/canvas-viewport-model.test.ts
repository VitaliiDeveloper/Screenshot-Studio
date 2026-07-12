// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { clientToViewportPoint, nextAnchoredScroll } from "./canvas-viewport-model.js";

describe("canvas viewport model", () => {
  it("converts a client point into viewport-local coordinates", () => {
    const rect = { left: 80, top: 48 } as DOMRectReadOnly;

    expect(clientToViewportPoint(rect, { x: 260, y: 198 })).toEqual({ x: 180, y: 150 });
  });

  it("keeps the pointer's content coordinate stable across zoom", () => {
    const result = nextAnchoredScroll({
      scrollLeft: 120,
      scrollTop: 80,
      anchor: { x: 240, y: 180 },
      previousZoom: 1,
      nextZoom: 2,
      leftInset: 48,
      rightInset: 0,
    });

    expect(result.scrollLeft).toBe(480);
    expect(result.scrollTop).toBe(340);
  });
});
