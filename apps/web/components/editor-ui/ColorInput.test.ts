// SPDX-License-Identifier: Apache-2.0
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ColorInput, colorInputValue, pickedColor } from "./ColorInput.js";

describe("colorInputValue", () => {
  it.each([
    ["#ABC", "#aabbcc"],
    ["#112233", "#112233"],
    ["#11223380", "#112233"],
    ["#00000000", "#000000"],
  ])("reduces %s to %s", (color, expected) => {
    expect(colorInputValue(color)).toBe(expected);
  });
});

describe("pickedColor", () => {
  it("keeps a partial alpha and adds none to an opaque colour", () => {
    expect(pickedColor("#ff0000", "#11223380")).toBe("#ff000080");
    expect(pickedColor("#ff0000", "#112233")).toBe("#ff0000");
    expect(pickedColor("#ff0000", "#abc")).toBe("#ff0000");
  });

  it("makes a fully transparent colour opaque, since the pick would not show otherwise", () => {
    expect(pickedColor("#ff0000", "#00000000")).toBe("#ff0000");
  });
});

describe("ColorInput", () => {
  it("paints the real value and gives the native input one it can hold", () => {
    const markup = renderToStaticMarkup(createElement(ColorInput, {
      value: "#11223380",
      onChange: vi.fn(),
      "aria-label": "Fill",
    }));

    expect(markup).toContain('style="background-color:#11223380"');
    expect(markup).toContain('value="#112233"');
    expect(markup).toContain('aria-label="Fill"');
  });
});
