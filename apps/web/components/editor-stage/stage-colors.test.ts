// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { readTokensCss, tokenBlock } from "@web/components/editor-ui/token-css-test-helpers";
import { DEFAULT_STAGE_COLORS, readStageColors, STAGE_COLOR_TOKENS, type StageColors } from "./stage-colors.js";

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

  it("keeps the server-render defaults equal to the declared light tokens", async () => {
    const tokens = tokenBlock(await readTokensCss(), ":root");

    for (const key of Object.keys(STAGE_COLOR_TOKENS) as Array<keyof StageColors>) {
      expect(tokens.get(STAGE_COLOR_TOKENS[key]), STAGE_COLOR_TOKENS[key]).toBe(DEFAULT_STAGE_COLORS[key]);
    }
  });
});
