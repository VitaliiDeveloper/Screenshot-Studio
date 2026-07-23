// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { ICON_IDS } from "./schema.js";
import { ICON_PATHS } from "./icons.js";

describe("trusted icon registry", () => {
  it("has one non-empty normalised path for every strict icon id", () => {
    expect(Object.keys(ICON_PATHS).sort()).toEqual([...ICON_IDS].sort());
    for (const id of ICON_IDS) {
      expect(ICON_PATHS[id]).toMatch(/^M/);
      expect(ICON_PATHS[id]).not.toMatch(/<|>|javascript:|url\(/i);
    }
  });
});
