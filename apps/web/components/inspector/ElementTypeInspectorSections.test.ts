// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DeviceFrameElement, ScreenshotElement, TextElement } from "@screenshot-studio/core/model";
import { ElementTypeInspectorSections } from "./ElementTypeInspectorSections.js";

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
  it("uses a project asset chooser instead of exposing the internal asset path as a field", () => {
    const markup = renderDeviceFrame(deviceFrame);

    expect(markup).toContain("No screenshot assigned");
    expect(markup).toContain("Choose screenshot");
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

    expect(markup).toContain("Classic Punch-Hole Phone");
    expect(markup).toContain("Choose frame");
    expect(markup).not.toContain('aria-label="Frame preset"');
    expect(markup).not.toContain(">android-phone<");
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
      }));
    } finally {
      if (previousReact === undefined) Reflect.deleteProperty(globalThis, "React");
      else Reflect.set(globalThis, "React", previousReact);
    }

    expect(markup).toContain('aria-label="Content mode"');
    expect(markup).toContain("Fill");
    expect(markup).not.toContain(">cover<");
  });
});
