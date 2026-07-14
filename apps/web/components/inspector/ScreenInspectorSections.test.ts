// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ensureStoreOutputFamily,
  ensureStoreTargetVariant,
  type Project,
} from "@screenshot-studio/core/model";
import {
  artboardTargetStatus,
  parseStoreSpecs,
  type StoreSize,
  type StoreSpecs,
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

const series11Target: StoreSize = {
  id: "series-11",
  label: "Apple Watch Series 11",
  width: 416,
  height: 496,
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

const watchSpecs = parseStoreSpecs({ apple: { watchos: [leadTarget, series11Target] } });
const leadOnlyWatchSpecs = parseStoreSpecs({ apple: { watchos: [leadTarget] } });

function createWatchFamily() {
  return ensureStoreOutputFamily(
    sourceProject(),
    "iphone-root",
    "apple",
    "watchos",
    leadTarget,
  );
}

function createWatchVariant() {
  const family = createWatchFamily();
  return ensureStoreTargetVariant(
    family.project,
    family.firstScreen.id,
    series11Target,
  );
}

function replaceScreen(project: Project, screen: Project["screens"][number]): Project {
  return {
    ...project,
    screens: project.screens.map((candidate) => candidate.id === screen.id ? screen : candidate),
  };
}

function renderInspector(
  project: Project,
  screen: Project["screens"][number],
  specs: StoreSpecs,
): string {
  return renderToStaticMarkup(React.createElement(ScreenInspectorSections, {
    project,
    screen,
    specs,
    leadTarget,
    leadStatus: artboardTargetStatus(screen.artboard, leadTarget),
  }));
}

describe("ScreenInspectorSections watchOS master status", () => {
  it("shows a newly created 3.5x watchOS master as Custom", () => {
    const result = createWatchFamily();
    const screen = result.firstScreen;
    const markup = renderInspector(result.project, screen, leadOnlyWatchSpecs);

    expect(markup).toContain(
      'aria-label="Customize master size" aria-pressed="true"',
    );
    expect(markup).toContain("1477 × 1799 px");
    expect(markup).toContain(
      "This custom master exports at the fixed 422 × 514 px size for Apple Watch Ultra 3.",
    );
    expect(markup).not.toContain("Explicit custom scale");
  });

  it("shows a proportional watchOS target variant as a custom authoring canvas", () => {
    const result = createWatchVariant();
    const screen = result.variant;
    const markup = renderInspector(result.project, screen, watchSpecs);

    expect(screen.artboard).toEqual({ width: 1456, height: 1736 });
    expect(markup).toContain("Authoring size");
    expect(markup).toContain("Custom");
    expect(markup).toContain(
      "This custom variant exports at the fixed 416 × 496 px size for Apple Watch Series 11.",
    );
    expect(markup).not.toContain("Exact target");
  });

  it("keeps a persisted exact watchOS target variant classified as exact", () => {
    const created = createWatchVariant();
    const screen = {
      ...created.variant,
      artboard: { width: series11Target.width, height: series11Target.height },
    };
    const markup = renderInspector(replaceScreen(created.project, screen), screen, watchSpecs);

    expect(markup).toContain("Target size");
    expect(markup).toContain("Exact target");
    expect(markup).toContain("This variant uses fixed Store Target dimensions.");
    expect(markup).not.toContain("Authoring size");
  });

  it("warns when a variant artboard cannot scale to its selected target", () => {
    const created = createWatchVariant();
    const screen = {
      ...created.variant,
      artboard: { width: 1456, height: 1700 },
    };
    const markup = renderInspector(replaceScreen(created.project, screen), screen, watchSpecs);

    expect(markup).toContain("Invalid target");
    expect(markup).toContain(
      "This variant cannot export to its Store Target because the artboard aspect ratio does not match.",
    );
  });

  it("warns when a variant references an unavailable target", () => {
    const created = createWatchVariant();
    const markup = renderInspector(created.project, created.variant, leadOnlyWatchSpecs);

    expect(markup).toContain("Invalid target");
    expect(markup).toContain(
      "This variant references a Store Target that is not available in the current specifications.",
    );
  });
});
