// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTextElement } from "@screenshot-studio/core/model";
import { SelectionToolbar } from "./SelectionToolbar";

// Vitest compiles the Next.js-preserved JSX with the classic runtime for this Node-only render.
Object.assign(globalThis, { React });

const element = { ...createTextElement({ x: 0, y: 0 }), color: "#112233" };

function render(fitSize: number | null | undefined) {
  return renderToStaticMarkup(React.createElement(SelectionToolbar, {
    element,
    fonts: [],
    fitSize,
    style: {},
    onChange: () => undefined,
    onFit: () => undefined,
  })).replace(/ class="[^"]*"/g, "");
}

describe("SelectionToolbar", () => {
  it("offers Font, Color, and Fit under labels that do not collide with the Layer tab", () => {
    const markup = render(40);
    expect(markup).toContain('role="toolbar" aria-label="Selection actions"');
    expect(markup).toContain('aria-label="Selection font"');
    expect(markup).toMatch(/aria-label="Selection font"[^]*>Font</);
    expect(markup).toContain('aria-label="Selection color" value="#112233"');
    expect(markup).toMatch(/<button type="button" aria-label="Fit text"(?![^>]*disabled)[^>]*>Fit<\/button>/);
  });

  it("disables Fit unless the layer overflows and a size fits", () => {
    expect(render(undefined)).toMatch(/aria-label="Fit text" disabled="" title="The text fits its box\."/);
    expect(render(null)).toMatch(/aria-label="Fit text" disabled="" title="The text overflows even at 1 px\./);
  });
});
