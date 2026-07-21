// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { elementLabel, viewToArrayIndex } from "@web/lib/panel-helpers.js";

describe("elementLabel", () => {
  it("uses the name when present", () => {
    expect(elementLabel({ type: "text", name: "Headline" })).toBe("Headline");
  });
  it("falls back to a type label when name is empty/absent", () => {
    expect(elementLabel({ type: "device-frame" })).toBe("Device frame");
    expect(elementLabel({ type: "text", name: "   " })).toBe("Text");
  });
  it.each([
    ["text", "Text"],
    ["shape", "Shape"],
    ["screenshot", "Screenshot"],
    ["image", "Image"],
    ["icon", "Icon"],
    ["device-frame", "Device frame"],
    ["group", "Group"],
  ] as const)("labels the current %s element type", (type, label) => {
    expect(elementLabel({ type })).toBe(label);
  });
});

describe("viewToArrayIndex (reversed layers list)", () => {
  // 3 elements [A,B,C]; rendered top→bottom as C,B,A (index 0,1,2).
  it("maps the top visible row to the last array element", () => {
    expect(viewToArrayIndex(3, 0)).toBe(2); // top row = C = array index 2
    expect(viewToArrayIndex(3, 2)).toBe(0); // bottom row = A = array index 0
  });
  it("a drag from visual-top to visual-bottom yields the correct array move", () => {
    // dragging the top row (view 0) to the bottom (view 2) = array move 2 -> 0
    expect([viewToArrayIndex(3, 0), viewToArrayIndex(3, 2)]).toEqual([2, 0]);
  });
});
