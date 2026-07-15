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
  const target = screen.storeTargetId
    ? specs[screen.platform]?.[screen.device]?.find((candidate) => candidate.id === screen.storeTargetId)
    : leadTarget;
  return renderToStaticMarkup(React.createElement(ScreenInspectorSections, {
    project,
    screen,
    specs,
    target,
  }));
}

describe("ScreenInspectorSections Store Target artboard size", () => {
  it("shows a newly created 3.5x watchOS lead as a custom artboard", () => {
    const result = createWatchFamily();
    const screen = result.firstScreen;
    const markup = renderInspector(result.project, screen, leadOnlyWatchSpecs);

    expect(markup).toContain(
      'aria-label="Use custom artboard size" aria-pressed="true"',
    );
    expect(markup).toContain('aria-label="Artboard size mode"');
    expect(markup).toContain(">Artboard</h3>");
    expect(markup).not.toContain("Editing size");
    expect(markup).toContain("Store size");
    expect(markup).toContain("1477 × 1799 px");
    expect(markup).toContain(
      "Exports at 422 × 514 px for Apple Watch Ultra 3.",
    );
    expect(markup).not.toContain("Master size");
  });

  it("shows a proportional watchOS variant with the same custom artboard controls", () => {
    const result = createWatchVariant();
    const screen = result.variant;
    const markup = renderInspector(result.project, screen, watchSpecs);

    expect(screen.artboard).toEqual({ width: 1456, height: 1736 });
    expect(markup).toContain('aria-label="Artboard size mode"');
    expect(markup).toContain(
      'aria-label="Use custom artboard size" aria-pressed="true"',
    );
    expect(markup).toContain(">Artboard</h3>");
    expect(markup).not.toContain("Editing size");
    expect(markup).toContain("Store size");
    expect(markup).toContain("1456 × 1736 px");
    expect(markup).toContain(
      "Exports at 416 × 496 px for Apple Watch Series 11.",
    );
    expect(markup).not.toContain("Exact target");
  });

  it("shows a persisted exact watchOS variant in fixed mode", () => {
    const created = createWatchVariant();
    const screen = {
      ...created.variant,
      artboard: { width: series11Target.width, height: series11Target.height },
    };
    const markup = renderInspector(replaceScreen(created.project, screen), screen, watchSpecs);

    expect(markup).toContain(
      'aria-label="Use Store size" aria-pressed="true"',
    );
    expect(markup).toContain("416 × 496 px");
    expect(markup).toContain(
      "Exports at 416 × 496 px for Apple Watch Series 11.",
    );
  });

  it("disables artboard size controls when the Store Target is unavailable", () => {
    const result = createWatchVariant();
    const markup = renderInspector(result.project, result.variant, leadOnlyWatchSpecs);

    expect(markup).toContain('aria-label="Use Store size"');
    expect(markup).toContain('aria-label="Use custom artboard size"');
    expect(markup).toContain(
      'aria-label="Use Store size" aria-pressed="false" disabled=""',
    );
    expect(markup).toContain(
      'aria-label="Use custom artboard size" aria-pressed="false" disabled=""',
    );
    expect(markup).toContain("This screen references a Store Target that is unavailable.");
  });
});
