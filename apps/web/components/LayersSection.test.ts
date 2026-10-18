// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTextElement, parseProject } from "@screenshot-studio/core/model";
import { editorStore } from "@web/lib/editor/editor-store";
import { LayerNameButton, LayersHeading, LayersSection } from "./LayersSection";

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

  it("keeps a renamed text layer to one line, with its text as tooltip and description", () => {
    const markup = renderToStaticMarkup(createElement(LayerNameButton, {
      element: { ...text, name: "Hero support" },
    }));
    const describedBy = /aria-describedby="([^"]+)"/.exec(markup)?.[1];

    expect(markup).toContain('aria-label="Hero support"');
    expect(markup).toContain('title="Fast, reliable shipping"');
    expect(markup).toContain(`<span id="${describedBy}" hidden="">Fast, reliable shipping</span>`);
  });

  it("uses an unnamed text layer's text as its label", () => {
    const markup = renderToStaticMarkup(createElement(LayerNameButton, { element: text }));

    expect(markup).toContain('aria-label="Fast, reliable shipping"');
    expect(markup).not.toContain("aria-describedby");
    expect(markup).toContain('title="Fast, reliable shipping"');
  });
});

describe("layer rows", () => {
  const sample = JSON.parse(readFileSync(
    new URL("../../../fixtures/sample/app-store-screenshots.json", import.meta.url),
    "utf8",
  ));
  const solid = "bg-[var(--editor-color-accent)]";
  const soft = "bg-[var(--editor-color-accent-muted)]";

  beforeEach(() => {
    const hero = sample.layouts[0].screens[0];
    const project = parseProject({
      ...sample,
      layouts: [{
        ...sample.layouts[0],
        screens: [
          { ...hero, elements: hero.elements.map((element: { name?: string }, index: number) =>
            index === 0 ? { ...element, name: "Background panel", locked: true } : element) },
          ...sample.layouts[0].screens.slice(1),
        ],
      }],
    });
    editorStore.setState({ project: null, activeScreenId: null, selectedItems: [] });
    editorStore.getState().load(project);
    // Server rendering reads zustand's initial state; serve the loaded project instead.
    vi.spyOn(editorStore, "getInitialState").mockImplementation(() => editorStore.getState());
  });
  afterEach(() => vi.restoreAllMocks());

  const render = () => renderToStaticMarkup(createElement(LayersSection, { onOpenAdd: () => undefined }));
  const headlineId = () => editorStore.getState().project!.layouts[0]!.screens[0]!.elements
    .find((element) => element.name === "Hero headline")!.id;
  const supportId = () => editorStore.getState().project!.layouts[0]!.screens[0]!.elements
    .find((element) => element.name === "Hero support")!.id;

  it("fills the only selected layer with the accent and several selected layers lightly", () => {
    editorStore.getState().select(headlineId(), "hero");
    const single = render();
    expect(single).toContain(solid);
    // Touch has no hover: the selected row is where its hidden controls take taps.
    expect(single.match(/data-selected="true"/g)).toHaveLength(1);

    editorStore.getState().select(supportId(), "hero", "toggle");
    const multi = render();
    expect(multi).not.toContain(solid);
    expect(multi.match(new RegExp(soft.replace(/[[\]()]/g, "\\$&"), "g"))).toHaveLength(2);
  });

  it("marks a locked layer with a chip and keeps the lock toggle labelled", () => {
    const markup = render();

    expect(markup).toContain(">Locked</span>");
    expect(markup).toContain('aria-label="Unlock Background panel"');
    expect(markup).toContain('aria-label="Lock Hero headline"');
  });

  it("shows the drag handle and more actions on hover or focus within the row", () => {
    const markup = render();
    const more = /<button[^>]*aria-label="More actions for Hero headline"[^>]*>/.exec(markup)?.[0];
    const handle = /<span[^>]*aria-label="Drag to reorder"[^>]*>/.exec(markup)?.[0];

    expect(more).toContain("opacity-0 group-hover:opacity-100 group-focus-within:opacity-100");
    expect(more).toContain("[@media(hover:none)]:pointer-events-none");
    expect(handle).toContain("opacity-0 group-hover:opacity-100 group-focus-within:opacity-100");
    expect(markup).toContain("pl-[34px]");
  });
});
