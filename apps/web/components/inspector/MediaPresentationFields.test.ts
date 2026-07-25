// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ScreenshotElement } from "@screenshot-studio/core/model";
import {
  cornerRadiusMode,
  cornerRadiusPresetValue,
  MediaPresentationFields,
} from "./MediaPresentationFields.js";

Object.assign(globalThis, { React });

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

  it("keeps the exact radius readable instead of exposing geometry noise", () => {
    const element: ScreenshotElement = {
      id: "screenshot",
      type: "screenshot",
      x: 0,
      y: 0,
      width: 968,
      height: 1640,
      rotation: 0,
      opacity: 1,
      locked: false,
      visible: true,
      assetUrl: "screenshots/checkout.png",
      fit: "cover",
      cornerRadius: 98.67272727272727,
    };

    const markup = renderToStaticMarkup(React.createElement(MediaPresentationFields, {
      element,
      onChange: () => undefined,
    }));

    expect(markup).toContain('aria-label="Exact value"');
    expect(markup).toContain('value="98.67"');
  });
});
