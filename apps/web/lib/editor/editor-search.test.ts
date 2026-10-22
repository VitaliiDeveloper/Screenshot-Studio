// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProject } from "@screenshot-studio/core/model";
import { findScreensAndLayers, MAX_SEARCH_RESULTS, stepActiveIndex } from "./editor-search";

const sample = JSON.parse(readFileSync(
  new URL("../../../../fixtures/sample/app-store-screenshots.json", import.meta.url),
  "utf8",
));
const screens = parseProject(sample).layouts[0]!.screens.slice(0, 3);

describe("findScreensAndLayers", () => {
  it("lists each screen followed by its layers, front-most first, for an empty query", () => {
    const results = findScreensAndLayers(screens, "  ");

    expect(results.slice(0, 7).map(({ label, detail }) => [label, detail])).toEqual([
      ["Hero", "5 layers"],
      ["Shipments app", "Device frame · Hero"],
      ["Hero support", "Text · Hero"],
      ["Hero headline", "Text · Hero"],
      ["Shape", "Shape · Hero"],
      ["Shape", "Shape · Hero"],
      ["Save Fast", "5 layers"],
    ]);
    expect(results.filter((result) => result.elementId === undefined).map((result) => result.screenId))
      .toEqual(screens.map((screen) => screen.id));
  });

  it("matches a screen by name and a layer by name, text, or type, ignoring case", () => {
    expect(findScreensAndLayers(screens, "STAY").map((result) => result.label))
      .toEqual(["Stay Organized", "Stay organized support", "Stay organized headline"]);
    expect(findScreensAndLayers(screens, "shipping").map((result) => [result.screenId, result.elementId]))
      .toEqual([["hero", "hero-support"]]);
    expect(findScreensAndLayers(screens, "device frame").map((result) => result.elementId))
      .toEqual(["hero-device", "save-fast-device"]);
    expect(findScreensAndLayers(screens, "no such thing")).toEqual([]);
  });

  it("does not list a screen's layers just because its name matches", () => {
    expect(findScreensAndLayers(screens, "hero").map((result) => result.label))
      .toEqual(["Hero", "Hero support", "Hero headline"]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: MAX_SEARCH_RESULTS + 5 }, (_, index) => ({
      ...screens[0]!,
      id: `s${index}`,
      name: `Screen ${index}`,
      elements: [],
    }));

    expect(findScreensAndLayers(many, "")).toHaveLength(MAX_SEARCH_RESULTS);
  });
});

describe("stepActiveIndex", () => {
  it("wraps at both ends and has no active option for an empty list", () => {
    expect(stepActiveIndex(0, 1, 3)).toBe(1);
    expect(stepActiveIndex(2, 1, 3)).toBe(0);
    expect(stepActiveIndex(0, -1, 3)).toBe(2);
    expect(stepActiveIndex(-1, 1, 0)).toBe(-1);
  });
});
