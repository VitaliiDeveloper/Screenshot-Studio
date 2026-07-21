// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { editorUi } from "@web/components/editor-ui/styles.js";
import { OptionalInspectorEffect } from "@web/components/inspector/OptionalInspectorEffect.js";

Object.assign(globalThis, { React });

describe("OptionalInspectorEffect", () => {
  it("uses the shared compact add action for a disabled effect", () => {
    const markup = renderToStaticMarkup(React.createElement(OptionalInspectorEffect, {
      title: "Gradient",
      description: "Blend two fill colors",
      enabled: false,
      onAdd: vi.fn(),
      onRemove: vi.fn(),
      children: null,
    }));

    expect(markup).toContain('aria-label="Add gradient"');
    expect(markup).toContain(editorUi.compactAddButton);
    expect(markup).toContain("Blend two fill colors");
  });

  it("labels the compact remove action when the effect is enabled", () => {
    const markup = renderToStaticMarkup(React.createElement(OptionalInspectorEffect, {
      title: "Stroke",
      description: "Outline the shape",
      enabled: true,
      onAdd: vi.fn(),
      onRemove: vi.fn(),
      children: React.createElement("span", null, "Stroke fields"),
    }));

    expect(markup).toContain('aria-label="Remove stroke"');
    expect(markup).toContain(editorUi.compactIconButton);
    expect(markup).toContain("Stroke fields");
  });
});
