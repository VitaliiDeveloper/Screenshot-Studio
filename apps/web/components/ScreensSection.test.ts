// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STORE_SPECS } from "@screenshot-studio/core/export";
import { parseProject } from "@screenshot-studio/core/model";
import type { ProjectIssue } from "@screenshot-studio/core/validation";
import { editorStore } from "@web/lib/editor/editor-store";
import type { WorkspaceView } from "@web/lib/editor/editor-workspace";
import { ScreenRowButton, ScreensSection, screenRowWarning, screensScopeLabel } from "./ScreensSection";

const sampleJson = JSON.parse(readFileSync(
  new URL("../../../fixtures/sample/app-store-screenshots.json", import.meta.url),
  "utf8",
));
const specs = DEFAULT_STORE_SPECS;

function withVariant() {
  const layout = sampleJson.layouts[0];
  const hero = layout.screens[0];
  return parseProject({
    ...sampleJson,
    layouts: [{
      ...layout,
      screens: [
        ...layout.screens,
        { ...hero, id: "hero-69", variantOf: "hero", storeTargetId: "6.9", artboard: { width: 1320, height: 2868 } },
      ],
    }],
  });
}

const overflow = (screenId: string, layoutId = "default"): ProjectIssue => ({
  kind: "text-overflow",
  id: `overflow-${screenId}-${layoutId}`,
  level: "warning",
  layoutId,
  screenId,
  elementId: "hero-title",
});

describe("screens header scope", () => {
  const project = parseProject(sampleJson);
  const layout = project.layouts[0]!;
  const iphone = layout.screens.filter((screen) => screen.device === "iphone");

  it("names the active size in Focus and counts sizes in Overview", () => {
    expect(screensScopeLabel(layout, iphone, iphone[0], "en", "focus", specs)).toBe('3 · EN · iPhone Dynamic Island · Medium');
    expect(screensScopeLabel(layout, iphone, iphone[0], "en", "overview", specs)).toBe("3 · EN · 2 sizes");
  });
});

describe("screen row warning", () => {
  const project = withVariant();
  const layout = project.layouts[0]!;
  const hero = layout.screens.find((screen) => screen.id === "hero")!;
  const saveFast = layout.screens.find((screen) => screen.id === "save-fast")!;

  it("names the size of another slot screen that has the issue", () => {
    expect(screenRowWarning(layout, hero, [overflow("hero-69")], specs)).toBe('Dynamic Island · Large: text overflows');
    expect(screenRowWarning(layout, hero, [overflow("hero-69"), overflow("hero")], specs))
      .toBe('Dynamic Island · Large: text overflows · 1 more');
  });

  it("ignores issues of other slots and other layouts", () => {
    expect(screenRowWarning(layout, saveFast, [overflow("hero-69")], specs)).toBeNull();
    expect(screenRowWarning(layout, hero, [overflow("hero", "other")], specs)).toBeNull();
  });

  it("reports a missing image and a locale that lacks the screen", () => {
    expect(screenRowWarning(layout, hero, [{
      kind: "missing-image", id: "img", level: "blocker", layoutId: "default",
      screenId: "hero", elementId: null, assetUrl: "assets/gone.png",
    }], specs)).toBe('Dynamic Island · Medium: image missing');
    expect(screenRowWarning(layout, hero, [{
      kind: "missing-locale-screen", id: "de", level: "blocker", layoutId: "default",
      locale: "de", sourceLocale: "en", sourceScreenId: "hero", allSizes: false,
    }], specs)).toBe("DE: screen missing");
  });
});

describe("screen row button", () => {
  const render = (active: boolean, warning: boolean, caption = "5 layers") => renderToStaticMarkup(
    createElement(ScreenRowButton, { name: "Track", caption, active, warning, "aria-label": "Track · iPhone" }),
  );

  it("describes the button with its caption and marks the active screen", () => {
    const markup = render(true, false);
    const describedBy = /aria-describedby="([^"]+)"/.exec(markup)?.[1];

    expect(markup).toContain('aria-current="true"');
    expect(markup).toContain(`id="${describedBy}"`);
    expect(markup).toContain("text-[color:var(--editor-color-accent-hover)]");
  });

  it("shows the warning text in the warning color instead of the layer count", () => {
    const markup = render(false, true, 'Dynamic Island · Medium: text overflows');

    expect(markup).not.toContain("aria-current");
    expect(markup).toContain("Dynamic Island · Medium: text overflows");
    expect(markup).toContain("text-[color:var(--editor-color-warning-text)]");
  });
});

describe("ScreensSection", () => {
  beforeEach(() => {
    editorStore.setState({ project: null, activeScreenId: null, selectedItems: [] });
    editorStore.getState().load(withVariant());
    // Server rendering reads zustand's initial state; serve the loaded project instead.
    vi.spyOn(editorStore, "getInitialState").mockImplementation(() => editorStore.getState());
  });
  afterEach(() => vi.restoreAllMocks());

  const render = (view: WorkspaceView, issues: ProjectIssue[] = []) => renderToStaticMarkup(createElement(ScreensSection, {
    images: new Map(),
    view,
    specs,
    issues,
    onOpenDialog: () => undefined,
    onImportCaptures: () => undefined,
    onOpenAdd: () => undefined,
  }));

  it("keeps the header and hover-or-focus row controls that touch reaches on the active row", () => {
    const markup = render("focus");

    expect(markup).toContain(">Screens</h2>");
    expect(markup).toContain("· 3 · EN · iPhone Dynamic Island · Medium");
    expect(markup).not.toContain("Find screen or layer");
    expect(markup).toContain('aria-label="Delete Save Fast"');
    const handle = /<span[^>]*aria-label="Drag to reorder"[^>]*>/.exec(markup)?.[0];
    expect(handle).toContain("opacity-0 group-hover:opacity-100 group-focus-within:opacity-100");
    expect(handle).toContain("[@media(hover:none)]:pointer-events-none");
    expect(markup.match(/data-selected="true"/g)).toHaveLength(1);
  });

  it("names the list and rows with catalog family copy instead of persisted device ids", () => {
    const markup = render("focus");

    expect(markup).toContain('aria-label="Screens for en · iPhone"');
    expect(markup).toContain('aria-label="Save Fast · iPhone"');
    expect(markup).not.toMatch(/aria-label="[^"]*· iphone"/);
  });

  it("counts sizes per screen in Overview and shows a slot's issue as a warning row", () => {
    const markup = render("overview", [overflow("hero-69"), overflow("save-fast")]);

    expect(markup).toContain("· 3 · EN · 3 sizes");
    expect(markup).toContain("Dynamic Island · Large: text overflows");
    expect(markup).toContain("Dynamic Island · Medium: text overflows");
    expect(markup).toContain(">1 size</span>");
    // The active row keeps its accent fill; only the inactive warning row turns amber.
    expect(markup.match(/border-dashed border-\[var\(--editor-color-warning-text\)\]/g)).toHaveLength(1);
  });
});
