// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  cornerRadiusMode,
  cornerRadiusPresetValue,
} from "./MediaPresentationFields.js";

describe("media presentation radius presets", () => {
  it("classifies any non-zero non-pill radius as Soft", () => {
    expect(cornerRadiusMode(0, { width: 968, height: 1640 })).toBe("square");
    expect(cornerRadiusMode(108, { width: 968, height: 1640 })).toBe("soft");
    expect(cornerRadiusMode(484, { width: 968, height: 1640 })).toBe("round");
  });

  it("derives preset values from element geometry", () => {
    expect(cornerRadiusPresetValue("square", { width: 968, height: 1640 })).toBe(0);
    expect(cornerRadiusPresetValue("soft", { width: 968, height: 1640 })).toBe(97);
    expect(cornerRadiusPresetValue("round", { width: 968, height: 1640 })).toBe(484);
  });
});
