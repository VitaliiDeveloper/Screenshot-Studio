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
  DEFAULT_STORE_SPECS,
  findStoreTarget,
  type StoreSize,
  type StoreSpecs,
} from "@screenshot-studio/core/export";
import {
  ScreenInspectorSections,
  storeAuthoringScale,
  storeAuthoringSize,
} from "./ScreenInspectorSections.js";

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
    fonts: [],
    preferredExportLayoutId: "primary",
    layouts: [{
      id: "primary",
      name: "Primary",
      mode: "isolated",
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
    }],
  };
}

const watchSpecs = structuredClone(DEFAULT_STORE_SPECS);
watchSpecs.platforms.apple.families.watchos.targets = [leadTarget, series11Target];
const leadOnlyWatchSpecs = structuredClone(DEFAULT_STORE_SPECS);
leadOnlyWatchSpecs.platforms.apple.families.watchos.targets = [leadTarget];

function createWatchFamily() {
  return ensureStoreOutputFamily(
    sourceProject(),
    "primary",
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
    "primary",
    family.firstScreen.id,
    series11Target,
  );
}

function replaceScreen(project: Project, screen: Project["layouts"][number]["screens"][number]): Project {
  return {
    ...project,
    layouts: project.layouts.map((layout) => ({
      ...layout,
      screens: layout.screens.map((candidate) => candidate.id === screen.id ? screen : candidate),
    })),
  };
}

function renderInspector(
  project: Project,
  screen: Project["layouts"][number]["screens"][number],
  specs: StoreSpecs,
): string {
  const target = screen.storeTargetId
    ? (() => {
        try {
          return findStoreTarget(specs, screen.platform, screen.device, screen.storeTargetId!);
        } catch {
          return undefined;
        }
      })()
    : leadTarget;
  return renderToStaticMarkup(React.createElement(ScreenInspectorSections, {
    layout: project.layouts[0]!,
    screen,
    specs,
    target,
  }));
}

describe("ScreenInspectorSections Store Target artboard size", () => {
  it("derives supported Store authoring scales and their exact dimensions", () => {
    expect(storeAuthoringScale(
      { width: 1206, height: 2622 },
      { width: 1206, height: 2622 },
    )).toBe("1");
    expect(storeAuthoringScale(
      { width: 2412, height: 5244 },
      { width: 1206, height: 2622 },
    )).toBe("2");
    expect(storeAuthoringScale(
      { width: 422 * 3.5, height: 514 * 3.5 },
      { width: 422, height: 514 },
    )).toBeUndefined();
    expect(storeAuthoringSize(
      { width: 1206, height: 2622 },
      "3",
    )).toEqual({ width: 3618, height: 7866 });
  });

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

  it("shows a persisted exact watchOS variant in Store size mode", () => {
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
    expect(markup).toContain('aria-label="Store authoring scale"');
    expect(markup).toContain('aria-label="Use 1× authoring scale" aria-pressed="true"');
  });

  it("keeps a persisted 2× Store-derived artboard in Store size mode", () => {
    const created = createWatchVariant();
    const screen = {
      ...created.variant,
      artboard: { width: series11Target.width * 2, height: series11Target.height * 2 },
    };
    const markup = renderInspector(replaceScreen(created.project, screen), screen, watchSpecs);

    expect(markup).toContain(
      'aria-label="Use Store size" aria-pressed="true"',
    );
    expect(markup).toContain(
      'aria-label="Use 2× authoring scale" aria-pressed="true"',
    );
    expect(markup).toContain("832 × 992 px");
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
    expect(markup).toContain("This screen&#x27;s export size is unavailable.");
  });
});

describe("ScreenInspectorSections background controls", () => {
  function renderBackground(background: Project["layouts"][number]["screens"][number]["background"]): string {
    const project = sourceProject();
    const screen = { ...project.layouts[0]!.screens[0]!, background };
    return renderInspector(replaceScreen(project, screen), screen, DEFAULT_STORE_SPECS);
  }

  it("uses the selected preview-first Solid composition", () => {
    const markup = renderBackground({ type: "solid", color: "#091226" });

    expect(markup).toContain('role="img" aria-label="Background preview"');
    expect(markup).toContain('data-background-type="solid"');
    expect(markup).toContain('aria-label="Background type"');
    expect(markup).toContain('aria-label="Use Solid background" aria-pressed="true"');
    expect(markup).not.toContain('aria-label="Quick background color"');
    expect(markup).toContain('aria-label="Color"');
    expect(markup.indexOf('aria-label="Background type"')).toBeLessThan(markup.indexOf('aria-label="Color"'));
    expect(markup).toContain("#091226");
  });

  it("keeps Gradient controls contextual under the shared type switch", () => {
    const markup = renderBackground({
      type: "linear-gradient",
      from: "#112233",
      to: "#445566",
      angle: 45,
    });

    expect(markup).toContain('data-background-type="linear-gradient"');
    expect(markup).toContain('aria-label="Use Gradient background" aria-pressed="true"');
    expect(markup).not.toContain('ring-[var(--editor-color-accent)]');
    expect(markup).toContain('data-testid="background-context-controls"');
    expect(markup).toContain('aria-label="Gradient colors"');
    expect(markup).toContain('aria-label="From"');
    expect(markup).toContain('aria-label="To"');
    expect(markup).toContain('aria-label="Swap gradient colors"');
    expect(markup).toContain('aria-label="Gradient direction presets"');
    expect(markup).toContain('aria-label="Set gradient direction to Top-left to bottom-right" title="Top-left to bottom-right" aria-pressed="true"');
    expect(markup).toContain('aria-label="Reverse gradient direction" title="Reverse direction" aria-pressed="false"');
    expect(markup).toContain('aria-label="Angle"');
    expect(markup).toContain('transition-[height]');
  });

  it("shows an imported Image as a product asset instead of a raw URL field", () => {
    const markup = renderBackground({
      type: "image",
      assetUrl: "assets/background.png",
      fit: "cover",
      color: "#123456",
    });

    expect(markup).toContain('data-background-type="image"');
    expect(markup).toContain('aria-label="Use Image background" aria-pressed="true"');
    expect(markup).toContain("background.png");
    expect(markup).toContain("Replace background");
    expect(markup).toContain('aria-label="Background content mode"');
    expect(markup).not.toContain("Asset URL");
  });
});

describe("Stored on this screen", () => {
  it("shows the screen's persisted locale, destination, size, and layout as read-only facts", () => {
    const project = sourceProject();
    const screen = project.layouts[0]!.screens[0]!;
    const target = findStoreTarget(DEFAULT_STORE_SPECS, "apple", "iphone", "6.3");
    const markup = renderToStaticMarkup(React.createElement(ScreenInspectorSections, {
      layout: project.layouts[0]!,
      screen,
      specs: DEFAULT_STORE_SPECS,
      target,
    }));
    const start = markup.indexOf("Stored on this screen");
    const stored = markup.slice(start, markup.indexOf("</section>", start));

    const facts = stored.replace(/<[^>]+>/g, "|").split("|").filter(Boolean);

    expect(facts).toEqual([
      "Stored on this screen",
      "Locale", "EN · LTR",
      "Destination", "App Store · iPhone",
      "Size", "6.3&quot; · Portrait · 1206\u00a0×\u00a02622",
      "Layout", "Primary",
      "Each locale and size is its own screen. Switch screens to edit another.",
    ]);
    expect(stored).not.toMatch(/<(input|button|select)\b/);
  });
});
