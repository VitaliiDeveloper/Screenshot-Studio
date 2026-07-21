// SPDX-License-Identifier: Apache-2.0
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LayersHeading } from "@web/components/LayersSection";

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
