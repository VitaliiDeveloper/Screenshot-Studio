// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { inspectorHeading, inspectorSelectionKey, resolveInspectorTab } from "./inspector-tab-model.js";
import { InspectorTabs } from "./InspectorTabs.js";

// Vitest compiles the Next.js-preserved JSX with the classic runtime for this Node-only render.
Object.assign(globalThis, { React });

const headline = inspectorSelectionKey([{ screenId: "hero", elementId: "headline" }]);

describe("inspector tab", () => {
  it("follows the selection when nothing was chosen", () => {
    expect(resolveInspectorTab("", null)).toBe("screen");
    expect(resolveInspectorTab(headline, null)).toBe("layer");
  });

  it("keeps a manual choice until the selection changes", () => {
    const choice = { tab: "screen" as const, selectionKey: headline };
    expect(resolveInspectorTab(headline, choice)).toBe("screen");
    expect(resolveInspectorTab(inspectorSelectionKey([
      { screenId: "hero", elementId: "subtitle" },
    ]), choice)).toBe("layer");
    expect(resolveInspectorTab("", choice)).toBe("screen");
    expect(resolveInspectorTab("", { tab: "layer", selectionKey: "" })).toBe("layer");
  });

  it("names the active screen on the Screen tab even when the selection is on a neighbour", () => {
    const selection = {
      activeScreenName: "First",
      selectedElements: [{ type: "text" as const, name: "Headline" }],
      selectionScreenName: "Second",
    };
    expect(inspectorHeading({ tab: "screen", ...selection })).toEqual(["First", "Screen"]);
    expect(inspectorHeading({ tab: "layer", ...selection })).toEqual(["Headline", "Text layer · Second"]);
    expect(inspectorHeading({ tab: "screen", ...selection, selectedElements: [] }))
      .toEqual(["First", "Screen · nothing selected"]);
    expect(inspectorHeading({
      tab: "layer",
      ...selection,
      selectedElements: [{ type: "text" }, { type: "shape" }],
    })).toEqual(["2 layers selected", "1 text · 1 shape"]);
  });

  it("renders an ARIA tablist with one focusable selected tab", () => {
    const markup = renderToStaticMarkup(React.createElement(InspectorTabs, {
      tab: "screen",
      idPrefix: "insp",
      onSelect: () => undefined,
    }));
    expect(markup).toContain('role="tablist"');
    expect(markup).toMatch(/id="insp-tab-layer"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
    expect(markup).toMatch(/id="insp-tab-screen"[^>]*aria-selected="true"[^>]*tabindex="0"/);
    expect(markup).toContain('aria-controls="insp-panel"');
  });
});
