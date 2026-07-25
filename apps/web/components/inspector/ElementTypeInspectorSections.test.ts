// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DeviceFrameElement, ScreenshotElement, TextElement } from "@screenshot-studio/core/model";
import { editorUi } from "@web/components/editor-ui";
import {
  deviceFrameSelectionPatch,
  ElementTypeInspectorSections,
} from "./ElementTypeInspectorSections.js";

const text: TextElement = {
  id: "copy",
  type: "text",
  x: 0,
  y: 0,
  width: 400,
  height: 200,
  rotation: 0,
  opacity: 1,
  locked: false,
  visible: true,
  content: "Copy",
  fontFamily: "Screenshot Studio Sans",
  size: 64,
  weight: 400,
  lineHeight: 1.2,
  letterSpacing: 0,
  align: "center",
  verticalAlign: "middle",
  color: "#FFFFFF",
};

describe("ElementTypeInspectorSections text semantics", () => {
  it("separates horizontal and vertical alignment and explains deferred theme roles", () => {
    const previousReact = Reflect.get(globalThis, "React");
    Reflect.set(globalThis, "React", React);
    let markup: string;
    try {
      markup = renderToStaticMarkup(React.createElement(ElementTypeInspectorSections, {
        element: text,
        fonts: [],
        onPatch: vi.fn(),
        onDuplicate: vi.fn(),
        onUngroup: vi.fn(),
      }));
    } finally {
      if (previousReact === undefined) Reflect.deleteProperty(globalThis, "React");
      else Reflect.set(globalThis, "React", previousReact);
    }

    expect(markup).toContain('aria-label="Horizontal align"');
    expect(markup).toContain('aria-label="Vertical align"');
    expect(markup).toContain("middle");
    expect(markup).toContain("Used the next time you apply a theme");
    expect(markup).toContain("The current style stays unchanged");
  });
});

const deviceFrame: DeviceFrameElement = {
  id: "mockup",
  type: "device-frame",
  x: 0,
  y: 0,
  width: 300,
  height: 625,
  rotation: 0,
  opacity: 1,
  locked: false,
  visible: true,
  deviceType: "android-phone",
  fit: "cover",
};

function renderDeviceFrame(element: DeviceFrameElement): string {
  const previousReact = Reflect.get(globalThis, "React");
  Reflect.set(globalThis, "React", React);
  try {
    return renderToStaticMarkup(React.createElement(ElementTypeInspectorSections, {
      element,
      fonts: [],
      onPatch: vi.fn(),
      onDuplicate: vi.fn(),
      onUngroup: vi.fn(),
      onChooseDeviceFrameAsset: vi.fn(),
    }));
  } finally {
    if (previousReact === undefined) Reflect.deleteProperty(globalThis, "React");
    else Reflect.set(globalThis, "React", previousReact);
  }
}

describe("ElementTypeInspectorSections device mockup assets", () => {
  it("selects the decorated square watch at 300x300 without replacing screenshot fields", () => {
    const wearFrame = {
      ...deviceFrame,
      width: 300,
      height: 300,
      deviceType: "frameless-watch",
      assetUrl: "screenshots/wear-home.png",
      fit: "contain",
      blur: 6,
    } as const satisfies DeviceFrameElement;

    const patch = deviceFrameSelectionPatch(wearFrame, "watch-square");
    expect(patch).toEqual({
      deviceType: "watch-square",
      height: 300,
    });
    expect({ ...wearFrame, ...patch }).toMatchObject({
      deviceType: "watch-square",
      width: 300,
      height: 300,
      assetUrl: "screenshots/wear-home.png",
      fit: "contain",
      blur: 6,
    });
  });

  it("uses a project asset chooser instead of exposing the internal asset path as a field", () => {
    const markup = renderDeviceFrame(deviceFrame);

    expect(markup).toContain("No screenshot assigned");
    expect(markup).toContain("Choose screenshot");
    expect(markup).toMatch(/class="[^"]*!text-\[13px\][^"]*"[^>]*>.*Choose screenshot/s);
    expect(markup).not.toContain('aria-label="Screenshot asset"');
  });

  it("offers replace and remove actions for an assigned screenshot", () => {
    const markup = renderDeviceFrame({ ...deviceFrame, assetUrl: "screenshots/checkout.png" });

    expect(markup).toContain("checkout.png");
    expect(markup).toContain("Replace screenshot");
    expect(markup).toContain('aria-label="Remove screenshot from device mockup"');
  });

  it("summarizes the human frame name and opens a visual picker instead of exposing raw IDs", () => {
    const markup = renderDeviceFrame(deviceFrame);
    const screenshotCard = markup.indexOf("No screenshot assigned");
    const frameCard = markup.indexOf("Classic Punch-Hole Phone");
    const contentMode = markup.indexOf("Content mode");
    const contentBlur = markup.indexOf("Content blur");

    expect(markup).toContain("Classic Punch-Hole Phone");
    expect(markup).toContain("Built-in device frame preset");
    expect(markup).toContain("Choose frame");
    expect(markup).toMatch(/class="[^"]*!text-\[13px\][^"]*"[^>]*>.*Choose frame/s);
    expect(markup.match(/lucide-panels-top-left/g)).toHaveLength(2);
    expect(markup).not.toContain('aria-label="Frame preset"');
    expect(markup).not.toContain(">android-phone<");
    expect(screenshotCard).toBeGreaterThanOrEqual(0);
    expect(contentBlur).toBeGreaterThan(contentMode);
    expect(screenshotCard).toBeGreaterThan(contentBlur);
    expect(frameCard).toBeGreaterThan(screenshotCard);
  });

  it("uses the same product-oriented Content mode control as screenshot media", () => {
    const markup = renderDeviceFrame(deviceFrame);

    expect(markup).toContain('role="group" aria-label="Content mode"');
    expect(markup).toContain("Fill");
    expect(markup).toContain("Fit");
    expect(markup.indexOf("Content mode")).toBeLessThan(markup.indexOf("Fill"));
  });
});

describe("ElementTypeInspectorSections media content mode", () => {
  it("presents cover as Fill through a clearly labelled content mode control", () => {
    const screenshot: ScreenshotElement = {
      id: "screenshot",
      type: "screenshot",
      x: 0,
      y: 0,
      width: 300,
      height: 650,
      rotation: 0,
      opacity: 1,
      locked: false,
      visible: true,
      assetUrl: "screenshots/checkout.png",
      fit: "cover",
      cornerRadius: 108,
      crop: { x: 0.5, y: 0.5, zoom: 1 },
    };
    const previousReact = Reflect.get(globalThis, "React");
    Reflect.set(globalThis, "React", React);
    let markup: string;
    try {
      markup = renderToStaticMarkup(React.createElement(ElementTypeInspectorSections, {
        element: screenshot,
        fonts: [],
        onPatch: vi.fn(),
        onDuplicate: vi.fn(),
        onUngroup: vi.fn(),
      }));
    } finally {
      if (previousReact === undefined) Reflect.deleteProperty(globalThis, "React");
      else Reflect.set(globalThis, "React", previousReact);
    }

    expect(markup).toContain('aria-label="Content mode"');
    expect(markup).toContain("Fill");
    expect(markup).not.toContain(">cover<");
    expect(markup.indexOf("Content mode")).toBeLessThan(markup.indexOf("Fill"));
    expect(markup).toContain('aria-pressed="true"');
    expect(markup.indexOf("Corner radius")).toBeLessThan(markup.indexOf("Square"));
    expect(markup).toContain("Soft");
    expect(markup).toContain("Round");
    expect(markup).toContain("Exact value");
    expect(markup).toContain("108");
    expect(markup).toContain("Add blur");
    expect(markup).toContain("Cover crop");
    expect(markup).toContain("Drag the focal point to reposition. Zoom to adjust the crop.");
    expect(markup).toContain('aria-label="Focal point"');
    expect(markup).toContain('aria-label="Crop zoom"');
    expect(markup).toContain('aria-label="Decrease crop zoom"');
    expect(markup).toContain('aria-label="Increase crop zoom"');
    expect(markup).toContain("Reset crop");
    expect(markup).toContain("Advanced");
    expect(markup).not.toContain("<details open");
    expect(markup).toContain("aspect-[3/2]");
    expect(markup).toContain('aria-label="Focal X %"');
    expect(markup).toContain('aria-label="Focal Y %"');
  });
});

describe("ElementTypeInspectorSections screenshot resources", () => {
  it("presents an assigned screenshot as a replaceable resource instead of a raw path field", () => {
    const screenshot: ScreenshotElement = {
      id: "screenshot",
      type: "screenshot",
      x: 0,
      y: 0,
      width: 300,
      height: 650,
      rotation: 0,
      opacity: 1,
      locked: false,
      visible: true,
      assetUrl: "screenshots/checkout.png",
      fit: "cover",
      cornerRadius: 0,
    };
    const previousReact = Reflect.get(globalThis, "React");
    Reflect.set(globalThis, "React", React);
    let markup: string;
    try {
      markup = renderToStaticMarkup(React.createElement(ElementTypeInspectorSections, {
        element: screenshot,
        fonts: [],
        onPatch: vi.fn(),
        onDuplicate: vi.fn(),
        onUngroup: vi.fn(),
        onChooseMediaAsset: vi.fn(),
        onRemoveElement: vi.fn(),
        effectiveLocked: true,
      }));
    } finally {
      if (previousReact === undefined) Reflect.deleteProperty(globalThis, "React");
      else Reflect.set(globalThis, "React", previousReact);
    }

    expect(markup).toContain("checkout.png");
    expect(markup).toContain("Replace");
    expect(markup).toContain('data-inspector-asset-thumbnail="screenshots/checkout.png"');
    expect(markup).toMatch(/data-inspector-asset-thumbnail="screenshots\/checkout\.png"[^>]*>.*<img/s);
    expect(markup).toContain('aria-label="Remove screenshot element"');
    expect(markup).not.toContain("Asset URL");
    expect(markup).not.toContain("screenshots/checkout.png</input>");
    expect(markup).toContain(editorUi.insetPanel);
    expect(markup).toMatch(/aria-label="Focal point"[^>]*disabled=""/);
    expect(markup).toMatch(/aria-label="Crop zoom"[^>]*disabled=""/);
    expect(markup).toMatch(/aria-label="Decrease crop zoom"[^>]*disabled=""/);
    expect(markup).toMatch(/aria-label="Increase crop zoom"[^>]*disabled=""/);
  });
});
