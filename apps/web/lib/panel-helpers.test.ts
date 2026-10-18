// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import {
  elementLabel,
  elementTextDescription,
  screenTreeSummary,
  selectionTypeSummary,
  viewToArrayIndex,
} from "./panel-helpers.js";

describe("screen tree labels", () => {
  it("counts layers and the screen's selected layers", () => {
    expect(screenTreeSummary(1, 0)).toBe("1 layer");
    expect(screenTreeSummary(5, 3)).toBe("5 layers · 3 selected");
  });
  it("summarizes a mixed selection by type in first-seen order", () => {
    expect(selectionTypeSummary([{ type: "text" }, { type: "shape" }, { type: "text" }]))
      .toBe("2 text · 1 shape");
    expect(selectionTypeSummary([{ type: "device-frame" }])).toBe("1 device frame");
  });
});

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

describe("text layer labels", () => {
  const long = "Track every parcel from pickup to your door";
  it("labels an unnamed text layer by its text on one line, cut to ~30 characters", () => {
    expect(elementLabel({ type: "text", content: "Fast,\n  reliable shipping" })).toBe("Fast, reliable shipping");
    expect(elementLabel({ type: "text", content: long })).toBe("Track every parcel from pickup…");
    expect(elementLabel({ type: "text", content: "  \n " })).toBe("Text");
  });
  it("keeps a renamed text layer's name and describes it by its full text", () => {
    expect(elementLabel({ type: "text", name: "Hero support", content: long })).toBe("Hero support");
    expect(elementTextDescription({ type: "text", name: "Hero support", content: `${long}\n` })).toBe(long);
  });
  it("describes an unnamed text layer only when its label is cut", () => {
    expect(elementTextDescription({ type: "text", content: long })).toBe(long);
    expect(elementTextDescription({ type: "text", content: "Fast,\n reliable shipping" })).toBeNull();
  });
  it("adds no description when there is no text or the text repeats the name", () => {
    expect(elementTextDescription({ type: "text", name: "Title", content: " " })).toBeNull();
    expect(elementTextDescription({ type: "text", name: "Save fast", content: "Save Fast" })).toBeNull();
    expect(elementTextDescription({ type: "shape", name: "Accent" })).toBeNull();
  });
  it("never splits a character made of several code units or code points", () => {
    expect(elementLabel({ type: "text", content: `${"a".repeat(29)}🚚🚚` })).toBe(`${"a".repeat(29)}🚚…`);
    expect(elementLabel({ type: "text", content: `${"a".repeat(29)}👩‍💻👩‍💻` })).toBe(`${"a".repeat(29)}👩‍💻…`);
    expect(elementLabel({ type: "text", content: `${"a".repeat(29)}🇺🇦🇺🇦` })).toBe(`${"a".repeat(29)}🇺🇦…`);
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
