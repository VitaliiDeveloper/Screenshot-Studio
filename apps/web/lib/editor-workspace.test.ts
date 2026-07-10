import { describe, expect, it } from "vitest";
import {
  clampZoom,
  filterAddCatalog,
  fitArtboardsZoom,
  fitZoom,
  OVERVIEW_GAP,
} from "./editor-workspace";

describe("editor workspace helpers", () => {
  it("clamps zoom to the supported viewport range", () => {
    expect(clampZoom(0.1)).toBe(0.25);
    expect(clampZoom(1.23456)).toBe(1.235);
    expect(clampZoom(9)).toBe(4);
  });

  it("fits content inside the viewport with stable padding", () => {
    expect(fitZoom({ width: 1400, height: 900 }, { width: 660, height: 1434 })).toBe(0.471);
    expect(fitZoom({ width: 0, height: 900 }, { width: 660, height: 1434 })).toBe(1);
  });

  it("keeps fixed canvas chrome outside the artboard zoom calculation", () => {
    const screens = Array.from({ length: 3 }, () => ({ width: 660, height: 1434 }));
    expect(fitArtboardsZoom({ width: 1400, height: 900 }, screens, { gap: OVERVIEW_GAP })).toBe(0.499);
    expect(fitArtboardsZoom({ width: 120, height: 900 }, screens, { gap: OVERVIEW_GAP })).toBe(0.25);
  });

  it("filters the extensible add catalog by label, group, and hint", () => {
    expect(filterAddCatalog("frame").map((item) => item.id)).toEqual(["device-frame"]);
    expect(filterAddCatalog("asset picker").map((item) => item.id)).toEqual([
      "screenshot",
      "device-frame",
    ]);
    expect(filterAddCatalog("")).toHaveLength(6);
  });
});
