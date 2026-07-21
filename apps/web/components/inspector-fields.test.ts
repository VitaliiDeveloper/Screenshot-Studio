// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { fontIdentityOptions } from "@web/components/inspector-fields.js";

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
