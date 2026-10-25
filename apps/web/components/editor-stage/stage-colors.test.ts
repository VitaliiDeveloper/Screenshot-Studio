// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { readTokensCss, tokenBlock } from "@web/components/editor-ui/token-css-test-helpers";
import { DEFAULT_STAGE_COLORS, readStageColors } from "./stage-colors.js";

describe("stage colors", () => {
  it("reads every overlay color from its token", () => {
    const values = new Map([
      ["--editor-color-selection", "#5b79ff"],
      ["--editor-color-snap-guide", " rgb(1 2 3) "],
    ]);
    const colors = readStageColors({ getPropertyValue: (name: string) => values.get(name) ?? "" });

    expect(colors.selection).toBe("#5b79ff");
    expect(colors.snapGuide).toBe("rgb(1 2 3)");
    expect(colors.overflow).toBe(DEFAULT_STAGE_COLORS.overflow);
  });

  it("keeps the server-render defaults equal to the light tokens", async () => {
    const tokens = tokenBlock(await readTokensCss(), ":root");

    expect(readStageColors({ getPropertyValue: (name: string) => tokens.get(name) ?? "" })).toEqual(DEFAULT_STAGE_COLORS);
    for (const name of ["--editor-color-selection", "--editor-color-canvas-boundary", "--editor-color-snap-guide"]) {
      expect(tokens.has(name)).toBe(true);
    }
  });
});
