// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ScreenshotElement } from "@screenshot-studio/core/model";
import { TransformInspectorFields } from "./TransformInspectorFields.js";

Object.assign(globalThis, { React });

const screenshot: ScreenshotElement = {
  id: "hero-shot",
  type: "screenshot",
  x: 176,
  y: 780,
  width: 968,
  height: 1640,
  rotation: 4,
  opacity: 1,
  locked: false,
  visible: true,
  assetUrl: "assets/demo-logistics-app.png",
  fit: "cover",
  cornerRadius: 108,
};

describe("TransformInspectorFields", () => {
  it("exposes direct and exact controls for every persisted transform value", () => {
    const markup = renderToStaticMarkup(React.createElement(TransformInspectorFields, {
      element: screenshot,
      artboard: { width: 1290, height: 2796 },
      onChange: vi.fn(),
      onInteractionEnd: vi.fn(),
    }));

    expect(markup).toContain('aria-label="Element position preview"');
    expect(markup).toContain('aria-label="X"');
    expect(markup).toContain('aria-label="Y"');
    expect(markup).toContain('aria-label="Lock aspect ratio"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('aria-label="Rotation dial"');
    expect(markup).toContain('data-rotation-dial-arc="active"');
    expect(markup).toContain('data-rotation-dial-thumb=""');
    expect(markup).toContain('aria-label="Opacity"');
    expect(markup).toContain('data-transform-secondary-controls="stacked"');
    expect(markup).toContain("Exported images are always flattened");
    expect(markup).toMatch(/aria-label="Element position preview"[^>]*class="[^"]*h-32 w-32/);
    expect(markup).not.toContain("h-40");
    expect(markup).toContain("grid-cols-[8rem_minmax(0,1fr)]");
    expect(markup).toContain("gap-5");
    expect(markup).not.toContain("grid-cols-[8rem_5.5rem] items-center justify-between gap-3");
    expect(markup).not.toContain("grid-cols-[7rem_minmax(0,1fr)]");
    expect(markup).not.toContain("grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)]");
    expect(markup).toContain("px");
    expect(markup).toContain("%");
  });

  it("forces ratio lock for device frames", () => {
    const markup = renderToStaticMarkup(React.createElement(TransformInspectorFields, {
      element: {
        ...screenshot,
        id: "frame",
        type: "device-frame",
        deviceType: "android-phone",
        assetUrl: undefined,
      },
      artboard: { width: 1290, height: 2796 },
      onChange: vi.fn(),
      onInteractionEnd: vi.fn(),
    }));

    expect(markup).toMatch(/aria-label="Lock aspect ratio"[^>]*disabled/);
    expect(markup).toContain('aria-pressed="true"');
  });

  it("disables direct manipulation for a locked element", () => {
    const markup = renderToStaticMarkup(React.createElement(TransformInspectorFields, {
      element: { ...screenshot, locked: true },
      artboard: { width: 1290, height: 2796 },
      onChange: vi.fn(),
      onInteractionEnd: vi.fn(),
    }));

    expect(markup).toMatch(/aria-label="Element position preview"[^>]*disabled=""/);
    expect(markup).toMatch(/aria-label="Rotation dial"[^>]*disabled=""/);
  });

  it("disables direct manipulation for an unlocked child of a locked group", () => {
    const markup = renderToStaticMarkup(React.createElement(TransformInspectorFields, {
      element: screenshot,
      artboard: { width: 1290, height: 2796 },
      effectiveLocked: true,
      onChange: vi.fn(),
      onInteractionEnd: vi.fn(),
    }));

    expect(markup).toMatch(/aria-label="Element position preview"[^>]*disabled=""/);
    expect(markup).toMatch(/aria-label="Rotation dial"[^>]*disabled=""/);
  });
});
