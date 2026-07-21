// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { TextElement } from "@screenshot-studio/core/model";
import { deriveInlineTextStyle } from "./inline-text-editing-model.js";

const element: TextElement = {
  id: "text", type: "text", x: 20, y: 30, width: 100, height: 40,
  rotation: 5, opacity: 0.8, locked: false, visible: true,
  content: "Text", fontFamily: "Inter", size: 18, weight: 400,
  lineHeight: 1.2, letterSpacing: 1, align: "right", color: "#123456",
};

describe("inline text editing model", () => {
  it("derives textarea geometry from owner-local projection and zoom", () => {
    expect(deriveInlineTextStyle({
      element,
      projection: { x: 100, y: 10, direction: "rtl" },
      baseX: -100,
      zoom: 2,
    })).toMatchObject({
      left: 40,
      top: 80,
      width: 200,
      height: 80,
      transform: "rotate(5deg)",
      transformOrigin: "top left",
      direction: "rtl",
      textAlign: "right",
    });
  });
});
