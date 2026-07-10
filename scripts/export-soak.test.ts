// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { hasMaterialMonotonicGrowth, median } from "./export-soak.mjs";

describe("export soak metrics", () => {
  it("calculates odd and even medians", () => {
    expect(median([4, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("flags only material consistently increasing RSS samples", () => {
    expect(hasMaterialMonotonicGrowth([100, 105, 110, 116, 121])).toBe(true);
    expect(hasMaterialMonotonicGrowth([100, 121, 106, 119, 122])).toBe(false);
    expect(hasMaterialMonotonicGrowth([100, 102, 104, 106, 110])).toBe(false);
  });
});
