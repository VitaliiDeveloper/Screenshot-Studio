// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEXT_FONT,
  isBuiltInFontIdentity,
  preferredAuthoringFont,
} from "./built-in-fonts.js";

describe("built-in fonts", () => {
  it("keeps empty projects authorable with a renderer-owned identity", () => {
    expect(preferredAuthoringFont([])).toEqual(DEFAULT_TEXT_FONT);
    expect(isBuiltInFontIdentity(DEFAULT_TEXT_FONT)).toBe(true);
  });

  it("continues to prefer a project's selected custom font", () => {
    const custom = { family: "Project Sans", weight: 700 };

    expect(preferredAuthoringFont([custom])).toBe(custom);
    expect(isBuiltInFontIdentity(custom)).toBe(false);
  });
});
