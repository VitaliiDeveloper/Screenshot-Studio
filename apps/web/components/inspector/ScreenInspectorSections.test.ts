// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ensureStoreOutputFamily,
  type Project,
} from "@screenshot-studio/core/model";
import {
  artboardTargetStatus,
  parseStoreSpecs,
  type StoreSize,
} from "@screenshot-studio/core/export";
import { ScreenInspectorSections } from "./ScreenInspectorSections.js";

// Vitest compiles the Next.js-preserved JSX with the classic runtime for this Node-only render.
Object.assign(globalThis, { React });

const leadTarget: StoreSize = {
  id: "ultra-3",
  label: "Apple Watch Ultra 3 (lead)",
  width: 422,
  height: 514,
  orientation: "portrait",
};

function sourceProject(): Project {
  return {
    meta: { name: "Inspector watchOS", schemaVersion: 1 },
    mode: "isolated",
    platforms: ["apple"],
    locales: ["en"],
    fonts: [],
    screens: [{
      id: "iphone-root",
      name: "Hero",
      platform: "apple",
      device: "iphone",
      locale: "en",
      direction: "ltr",
      artboard: { width: 1320, height: 2868 },
      background: { type: "solid", color: "#091226" },
      elements: [],
    }],
  };
}

describe("ScreenInspectorSections watchOS master status", () => {
  it("shows a newly created 3.5x watchOS master as Custom", () => {
    const result = ensureStoreOutputFamily(
      sourceProject(),
      "iphone-root",
      "apple",
      "watchos",
      leadTarget,
    );
    const screen = result.firstScreen;
    const specs = parseStoreSpecs({ apple: { watchos: [leadTarget] } });
    const markup = renderToStaticMarkup(React.createElement(ScreenInspectorSections, {
      project: result.project,
      screen,
      specs,
      leadTarget,
      leadStatus: artboardTargetStatus(screen.artboard, leadTarget),
    }));

    expect(markup).toContain(
      'aria-label="Customize master size" aria-pressed="true"',
    );
    expect(markup).toContain("1477 × 1799 px");
    expect(markup).toContain(
      "This custom master exports at the fixed 422 × 514 px size for Apple Watch Ultra 3.",
    );
    expect(markup).not.toContain("Explicit custom scale");
  });
});
