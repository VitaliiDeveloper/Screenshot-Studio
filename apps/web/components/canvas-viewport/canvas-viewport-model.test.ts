// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  activeArtboardScrollBehavior,
  clientToViewportPoint,
  nextAnchoredScroll,
  nextWheelZoom,
} from "./canvas-viewport-model.js";
import { clampZoom } from "@web/lib/editor/editor-workspace";

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
    });

    expect(result.scrollLeft).toBe(480);
    expect(result.scrollTop).toBe(340);
  });

  it("chains anchored scroll targets like one combined zoom step", () => {
    const anchor = { x: 240, y: 180 };
    const first = nextAnchoredScroll({ scrollLeft: 120, scrollTop: 80, anchor, previousZoom: 1, nextZoom: 1.5 });
    const chained = nextAnchoredScroll({ ...first, anchor, previousZoom: 1.5, nextZoom: 2 });

    expect(chained).toEqual(nextAnchoredScroll({ scrollLeft: 120, scrollTop: 80, anchor, previousZoom: 1, nextZoom: 2 }));
  });

  it("accumulates small pinch deltas that rounding would otherwise swallow", () => {
    let zoom = 0.1;
    let unrounded: number | null = null;
    for (let step = 0; step < 20; step += 1) {
      unrounded = nextWheelZoom({ zoom, unrounded, deltaY: 0.2 });
      zoom = clampZoom(unrounded);
    }

    expect(zoom).toBe(clampZoom(0.1 * Math.exp(-0.04)));
  });

  it("caps a mouse-wheel notch and restarts from an externally changed zoom", () => {
    expect(nextWheelZoom({ zoom: 1, unrounded: null, deltaY: 100 })).toBeCloseTo(Math.exp(-0.25));
    expect(nextWheelZoom({ zoom: 2, unrounded: 0.5004, deltaY: 0 })).toBe(2);
    expect(nextWheelZoom({ zoom: 4, unrounded: null, deltaY: -25 })).toBe(4);
  });

  it("does not animate active-artboard scrolling beneath overlay panels", () => {
    expect(activeArtboardScrollBehavior({
      leftInset: 0,
      rightInset: 288,
      reducedMotion: false,
    })).toBe("auto");
    expect(activeArtboardScrollBehavior({
      leftInset: 288,
      rightInset: 0,
      reducedMotion: false,
    })).toBe("auto");
  });

  it("keeps smooth active-artboard scrolling on unobstructed canvases", () => {
    expect(activeArtboardScrollBehavior({
      leftInset: 0,
      rightInset: 0,
      reducedMotion: false,
    })).toBe("smooth");
    expect(activeArtboardScrollBehavior({
      leftInset: 0,
      rightInset: 0,
      reducedMotion: true,
    })).toBe("auto");
  });
});
