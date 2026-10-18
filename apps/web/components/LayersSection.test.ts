// SPDX-License-Identifier: Apache-2.0
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTextElement } from "@screenshot-studio/core/model";
import { LayerNameButton, LayersHeading } from "./LayersSection";

describe("layers heading", () => {
  it("shows the active screen context without an unexplained owner badge", () => {
    const markup = renderToStaticMarkup(createElement(LayersHeading, {
      count: 6,
      screenName: "Hero",
      showScreenContext: true,
    }));

    expect(markup).toContain("Layers");
    expect(markup).toContain("Hero");
    expect(markup).not.toContain("Owner");
  });
});

describe("layer name button", () => {
  const text = { ...createTextElement({}), id: "support", content: "Fast, reliable shipping" };

  it("shows a named text layer's text as a muted description of the name", () => {
    const markup = renderToStaticMarkup(createElement(LayerNameButton, {
      element: { ...text, name: "Hero support" },
    }));
    const describedBy = /aria-describedby="([^"]+)"/.exec(markup)?.[1];

    expect(markup).toContain('aria-label="Hero support"');
    expect(markup).toContain(`id="${describedBy}"`);
    expect(markup).toContain("Fast, reliable shipping");
  });

  it("uses an unnamed text layer's text as its label", () => {
    const markup = renderToStaticMarkup(createElement(LayerNameButton, { element: text }));

    expect(markup).toContain('aria-label="Fast, reliable shipping"');
    expect(markup).not.toContain("aria-describedby");
  });
});
