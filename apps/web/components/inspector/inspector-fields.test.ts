// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  formatNumberFieldValue,
  normalizeNumberFieldValue,
  NumberField,
  percentToUnit,
  SelectField,
  SliderNumberField,
  TextField,
  unitToPercent,
} from "./inspector-fields.js";

Object.assign(globalThis, { React });

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

  it("maps persisted unit opacity to an Inspector percentage", () => {
    expect(unitToPercent(0)).toBe(0);
    expect(unitToPercent(0.65)).toBe(65);
    expect(unitToPercent(1)).toBe(100);
  });

  it("clamps Inspector percentages before persisting opacity", () => {
    expect(percentToUnit(-10)).toBe(0);
    expect(percentToUnit(65)).toBe(0.65);
    expect(percentToUnit(120)).toBe(1);
  });

  it("renders visible units without changing the numeric input name", () => {
    const markup = renderToStaticMarkup(React.createElement(NumberField, {
      label: "X",
      value: 176,
      suffix: "px",
      onChange: vi.fn(),
    }));

    expect(markup).toContain("px");
    expect(markup).toContain('aria-label="X"');
    expect(markup).toContain("editor-number-input");
    expect(markup).toContain("text-right");
  });

  it("links a native slider to an exact number and alpha-free export help", () => {
    const markup = renderToStaticMarkup(React.createElement(SliderNumberField, {
      label: "Opacity",
      value: 100,
      min: 0,
      max: 100,
      step: 1,
      suffix: "%",
      helpText: "Adjusts this layer’s transparency. Exported images are always flattened and contain no alpha channel.",
      onChange: vi.fn(),
    }));

    expect(markup).toContain('type="range"');
    expect(markup).toContain('aria-label="Opacity"');
    expect(markup).toContain("editor-range");
    expect(markup).toContain("contain no alpha channel");
    expect(markup).toContain('class="sr-only">Opacity value</span>');
  });

  it("keeps menu field titles inert instead of activating their button", () => {
    const markup = renderToStaticMarkup(React.createElement(SelectField, {
      label: "Content mode",
      value: "cover",
      options: ["cover", "contain"],
      optionLabels: { cover: "Fill", contain: "Fit" },
      onChange: vi.fn(),
    }));

    expect(markup).toMatch(/^<div /);
    expect(markup).not.toContain("<label");
    expect(markup).toContain('aria-label="Content mode"');
  });

  it("keeps multiline text content vertically resizable within readable bounds", () => {
    const markup = renderToStaticMarkup(React.createElement(TextField, {
      label: "Content",
      value: "Save fast",
      multiline: true,
      onChange: vi.fn(),
    }));

    expect(markup).toContain("min-h-[4.5rem]");
    expect(markup).toContain("max-h-48");
    expect(markup).toContain("resize-y");
    expect(markup).toContain("overflow-y-auto");
  });
});
