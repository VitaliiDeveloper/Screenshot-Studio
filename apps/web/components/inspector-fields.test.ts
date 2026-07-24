// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  fontIdentityOptions,
  formatNumberFieldValue,
  normalizeNumberFieldValue,
} from "./inspector-fields.js";

describe("number field formatting", () => {
  it("limits displayed transform precision without trailing zeroes", () => {
    expect(formatNumberFieldValue(1423.0067741681532, 2)).toBe("1423.01");
    expect(formatNumberFieldValue(79.72458754560415, 2)).toBe("79.72");
    expect(formatNumberFieldValue(1, 2)).toBe("1");
  });

  it("preserves full precision when no display precision is requested", () => {
    expect(formatNumberFieldValue(43.0270429585131)).toBe("43.0270429585131");
  });

  it("normalizes manually entered values to the configured precision", () => {
    expect(normalizeNumberFieldValue(1.2345, 2)).toBe(1.23);
    expect(normalizeNumberFieldValue(-7.896, 2)).toBe(-7.9);
    expect(normalizeNumberFieldValue(43.0270429585131)).toBe(43.0270429585131);
  });
});

describe("fontIdentityOptions", () => {
  it("offers the renderer-owned default before optional project fonts", () => {
    const options = fontIdentityOptions([], {
      family: "Screenshot Studio Sans",
      weight: 400,
    });

    expect(options).toEqual([{
      value: JSON.stringify(["Screenshot Studio Sans", 400]),
      label: "Studio Sans · Regular · Built-in",
    }]);
  });

  it("keeps missing identities visible and appends project fonts", () => {
    const options = fontIdentityOptions([{
      family: "Inter",
      source: "uploaded",
      path: "assets/fonts/inter.ttf",
      weight: 700,
    }], { family: "Missing", weight: 500 });

    expect(options.map(({ label }) => label)).toEqual([
      "Missing: Missing · 500",
      "Studio Sans · Regular · Built-in",
      "Inter · 700",
    ]);
  });
});
