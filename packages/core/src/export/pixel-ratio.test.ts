// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { exportPixelRatio } from "./index.js";

describe("exportPixelRatio", () => {
  it("scales a half-size artboard up to the store target", () => {
    const ratio = exportPixelRatio({ width: 660, height: 1434 }, { width: 1320, height: 2868 });
    expect(ratio).toBe(2);
  });

  it("returns 1 when the artboard already matches the target", () => {
    expect(exportPixelRatio({ width: 1320, height: 2868 }, { width: 1320, height: 2868 })).toBe(1);
  });

  it("scales a 3.5x watchOS master down to the lead target", () => {
    expect(exportPixelRatio(
      { width: 1477, height: 1799 },
      { width: 422, height: 514 },
    )).toBeCloseTo(2 / 7);
  });

  it("throws when aspect ratios differ (would distort)", () => {
    expect(() => exportPixelRatio({ width: 1000, height: 1000 }, { width: 1320, height: 2868 })).toThrow(
      /distort/,
    );
  });
});
