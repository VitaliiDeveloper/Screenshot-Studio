// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parseProject } from "@screenshot-studio/core/model";
import { findStoreTarget, leadStoreSizeId, parseStoreSpecs } from "@screenshot-studio/core/export";
import type { ProjectIssue } from "@screenshot-studio/core/validation";

// Vitest compiles the Next.js-preserved JSX with the classic runtime for this Node-only render.
Object.assign(globalThis, { React });

const mockEditorState = vi.hoisted(() => ({
  project: null as unknown,
  activeLayoutId: null as string | null,
}));

vi.mock("zustand", () => ({
  useStore: (_store: unknown, selector: (state: typeof mockEditorState) => unknown) => (
    selector(mockEditorState)
  ),
}));

vi.mock("./editor-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./editor-ui")>();
  return {
    ...actual,
    MenuSelect: ({ ariaLabel, options }: {
      ariaLabel: string;
      options: readonly { value: string; label: string }[];
    }) => React.createElement(
      "div",
      { "aria-label": `${ariaLabel} visible options` },
      options.map(({ value, label }) => React.createElement(
        "span",
        { key: `${value}:${label}`, "data-value": value },
        label,
      )),
    ),
  };
});

import { ExportDialog } from "./ExportDialog.js";

const specs = parseStoreSpecs(JSON.parse(readFileSync("store-specs.json", "utf8")));

function screen(id: string, platform: string, device: string, locale = "en") {
  return {
    id,
    name: id,
    platform,
    device,
    locale,
    direction: "ltr",
    artboard: { width: 1200, height: 1200 },
    background: { type: "solid", color: "#ffffff" },
    elements: [],
  };
}

function useLayout(screens: ReturnType<typeof screen>[]) {
  mockEditorState.project = parseProject({
    meta: { name: "Catalog", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [{ id: "default", name: "Default", mode: "isolated", screens }],
  });
  mockEditorState.activeLayoutId = "default";
}

function render(issues: ProjectIssue[] = []): string {
  return renderToStaticMarkup(React.createElement(ExportDialog, { open: true, onClose: vi.fn(), specs, issues }));
}

function exportButton(markup: string): string {
  return /<button[^>]*>(?:(?!<\/button>).)*Export \d+ files?<\/button>/u.exec(markup)![0];
}

afterEach(() => {
  mockEditorState.project = null;
  mockEditorState.activeLayoutId = null;
});

describe("ExportDialog", () => {
  it("lists every exact size with its store-specs pixels, the locales, and the real bundle paths", () => {
    useLayout([
      screen("iphone", "apple", "iphone"),
      screen("iphone-uk", "apple", "iphone", "uk"),
      screen("ipad", "apple", "ipad"),
      screen("tablet", "android", "tablet-7"),
      screen("desktop", "web", "desktop"),
    ]);

    const markup = render();

    for (const [label, platform, device] of [
      ["App Store · iPhone 6.3&quot; · Portrait", "apple", "iphone"],
      ["App Store · iPad 13&quot; · Portrait", "apple", "ipad"],
      ["Google Play · Tablet 7-inch · Portrait", "android", "tablet-7"],
      ["Web · Desktop 1920×1080 · Landscape", "web", "desktop"],
    ] as const) {
      const target = findStoreTarget(specs, platform, device, leadStoreSizeId(specs, platform, device));
      expect(markup).toContain(label);
      expect(markup).toContain(`${target.width} × ${target.height}`);
    }
    expect(markup).toContain("1206 × 2622");
    expect(markup).toMatch(/type="checkbox"[^>]*checked=""[^>]*\/><span[^>]*>uk<\/span>/u);
    expect(markup).toContain("apple/iphone/locale-en/size-6.3/01-iphone-6.3.png");
    expect(markup).toContain("5 files · 4 sizes × 2 locales · inside app-store-screenshots-bundle.zip");
    expect(exportButton(markup)).toContain("Export 5 files");
    expect(exportButton(markup)).not.toContain('disabled=""');
  });

  it("blocks export while a checked file has a blocker and shows warnings without blocking", () => {
    useLayout([screen("iphone", "apple", "iphone"), screen("iphone-uk", "apple", "iphone", "uk")]);
    const blocker: ProjectIssue = {
      kind: "missing-image", id: "i", level: "blocker", layoutId: "default",
      screenId: "iphone-uk", elementId: null, assetUrl: "assets/missing.png",
    };
    const warning: ProjectIssue = {
      kind: "text-overflow", id: "t", level: "warning", layoutId: "default", screenId: "iphone", elementId: "title",
    };

    const blocked = render([blocker, warning]);
    expect(blocked).toContain("1 blocker stops this export.");
    expect(exportButton(blocked)).toContain('disabled=""');

    const warned = render([warning]);
    expect(warned).toContain("1 warning in the checked files. Export still runs.");
    expect(exportButton(warned)).not.toContain('disabled=""');
  });
});
