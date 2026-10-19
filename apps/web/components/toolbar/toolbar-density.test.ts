// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  nextToolbarDensity,
  resolveToolbarDensityProbe,
  toolbarDensityProbeTarget,
  toolbarGap,
  toolbarMeasurementKey,
} from "./toolbar-density";

describe("nextToolbarDensity", () => {
  it("compacts labels before moving actions into overflow", () => {
    expect(nextToolbarDensity({ density: "full", currentGap: 19, previousGap: null })).toBe("compact");
    expect(nextToolbarDensity({ density: "compact", currentGap: 19, previousGap: 19 })).toBe("overflow-secondary");
    expect(nextToolbarDensity({ density: "overflow-secondary", currentGap: 19, previousGap: 19 })).toBe("overflow-locale");
    expect(nextToolbarDensity({ density: "overflow-locale", currentGap: 19, previousGap: 19 })).toBe("minimal");
  });

  it("enters minimal only below the 20px fitting boundary", () => {
    expect(nextToolbarDensity({ density: "overflow-locale", currentGap: 20, previousGap: 19 })).toBe("overflow-locale");
    expect(nextToolbarDensity({ density: "overflow-locale", currentGap: 19, previousGap: 19 })).toBe("minimal");
  });

  it("restores one priority level at a time with 28px hysteresis", () => {
    expect(nextToolbarDensity({ density: "minimal", currentGap: 40, previousGap: 27 })).toBe("minimal");
    expect(nextToolbarDensity({ density: "minimal", currentGap: 40, previousGap: 28 })).toBe("overflow-locale");
    expect(nextToolbarDensity({ density: "overflow-locale", currentGap: 40, previousGap: 27 })).toBe("overflow-locale");
    expect(nextToolbarDensity({ density: "overflow-locale", currentGap: 40, previousGap: 28 })).toBe("overflow-secondary");
    expect(nextToolbarDensity({ density: "overflow-secondary", currentGap: 40, previousGap: 28 })).toBe("compact");
    expect(nextToolbarDensity({ density: "compact", currentGap: 40, previousGap: 28 })).toBe("full");
  });
});

describe("toolbar density measurement probes", () => {
  it("probes only the immediately less-compact density", () => {
    expect(toolbarDensityProbeTarget("full")).toBeNull();
    expect(toolbarDensityProbeTarget("compact")).toBe("full");
    expect(toolbarDensityProbeTarget("overflow-secondary")).toBe("compact");
    expect(toolbarDensityProbeTarget("overflow-locale")).toBe("overflow-secondary");
    expect(toolbarDensityProbeTarget("minimal")).toBe("overflow-locale");
  });

  it("rejects a measured candidate below the 28px restoration boundary", () => {
    expect(resolveToolbarDensityProbe({
      fallbackDensity: "overflow-secondary",
      candidateDensity: "compact",
      candidateGap: 27,
    })).toBe("overflow-secondary");
  });

  it("accepts a measured candidate at the 28px restoration boundary", () => {
    expect(resolveToolbarDensityProbe({
      fallbackDensity: "overflow-secondary",
      candidateDensity: "compact",
      candidateGap: 28,
    })).toBe("compact");
  });
});

describe("toolbarGap", () => {
  it("returns the 20px fitting boundary", () => {
    expect(
      toolbarGap({
        headerWidth: 1000,
        horizontalPadding: 40,
        columnGap: 10,
        leftWidth: 350,
        centerWidth: 200,
        rightWidth: 360,
      }),
    ).toBe(20);
  });

  it("returns the 19px entry boundary", () => {
    expect(
      toolbarGap({
        headerWidth: 1000,
        horizontalPadding: 40,
        columnGap: 10,
        leftWidth: 350,
        centerWidth: 200,
        rightWidth: 361,
      }),
    ).toBe(19);
  });

  it("uses the narrower side for asymmetric toolbar groups", () => {
    expect(
      toolbarGap({
        headerWidth: 1000,
        horizontalPadding: 40,
        columnGap: 10,
        leftWidth: 342,
        centerWidth: 200,
        rightWidth: 355,
      }),
    ).toBe(25);
    expect(
      toolbarGap({
        headerWidth: 1000,
        horizontalPadding: 40,
        columnGap: 10,
        leftWidth: 355,
        centerWidth: 200,
        rightWidth: 342,
      }),
    ).toBe(25);
  });
});

describe("toolbarMeasurementKey", () => {
  it("changes when only the Export file count changes", () => {
    const key = (count: number | null) => toolbarMeasurementKey(["Demo", "default", "en", count]);
    expect(key(6)).not.toBe(key(12));
    expect(key(null)).not.toBe(key(6));
  });
});
