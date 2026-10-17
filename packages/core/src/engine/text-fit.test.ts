// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { largestFittingSize } from "./text-fit.js";

describe("largestFittingSize", () => {
  it("returns the largest whole size that fits, capped at the current size", () => {
    const probed: number[] = [];
    const fits = (size: number) => {
      probed.push(size);
      return size <= 66;
    };

    expect(largestFittingSize(96, fits)).toBe(66);
    expect(probed.length).toBeLessThanOrEqual(7);
    expect(largestFittingSize(40, fits)).toBe(40);
    expect(largestFittingSize(66.8, fits)).toBe(66);
  });

  it("returns null when even size 1 does not fit", () => {
    expect(largestFittingSize(96, () => false)).toBeNull();
    expect(largestFittingSize(0.5, () => true)).toBeNull();
  });
});
