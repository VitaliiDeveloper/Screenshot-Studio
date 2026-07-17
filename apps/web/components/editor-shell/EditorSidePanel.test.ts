import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EditorSidePanel } from "./EditorSidePanel";

function renderPanel(side: "left" | "right", open: boolean) {
  return renderToStaticMarkup(
    createElement(EditorSidePanel, {
      side,
      open,
      children: createElement("div", null, "Panel content"),
    }),
  );
}

describe("EditorSidePanel", () => {
  it("animates an open panel as a desktop width-bearing flex child", () => {
    const markup = renderPanel("left", true);

    expect(markup).toContain('data-editor-side-panel="left"');
    expect(markup).toContain('data-state="open"');
    expect(markup).toContain('aria-hidden="false"');
    expect(markup).not.toContain("inert");
    expect(markup).toContain("translate-x-0");
    expect(markup).toContain("opacity-100");
    expect(markup).toContain("xl:w-72");
  });

  it("keeps a closed panel mounted but hidden and non-interactive", () => {
    const markup = renderPanel("left", false);

    expect(markup).toContain('data-state="closed"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("inert");
    expect(markup).toContain("pointer-events-none");
    expect(markup).toContain("-translate-x-full");
    expect(markup).toContain("xl:-translate-x-3");
    expect(markup).toContain("opacity-0");
    expect(markup).toContain("xl:w-0");
    expect(markup).toContain("Panel content");
  });

  it("slides the right panel toward its own edge", () => {
    const markup = renderPanel("right", false);

    expect(markup).toContain("right-0");
    expect(markup).toContain("translate-x-full");
    expect(markup).toContain("xl:translate-x-3");
    expect(markup).not.toContain("-translate-x-full");
  });

  it("uses one reduced-motion-safe 200ms transition contract", () => {
    const markup = renderPanel("left", true);

    expect(markup).toContain("transition-[width,translate,opacity]");
    expect(markup).not.toContain("transition-[width,transform,opacity]");
    expect(markup).toContain("duration-200");
    expect(markup).toContain("ease-out");
    expect(markup).toContain("motion-reduce:duration-0");
  });
});
