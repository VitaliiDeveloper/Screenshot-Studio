// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseProject } from "@screenshot-studio/core/model";

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

function screen(id: string, platform: string, device: string) {
  return {
    id,
    name: id,
    platform,
    device,
    locale: "en",
    direction: "ltr",
    artboard: { width: 1200, height: 1200 },
    background: { type: "solid", color: "#ffffff" },
    elements: [],
  };
}

afterEach(() => {
  mockEditorState.project = null;
  mockEditorState.activeLayoutId = null;
});

describe("ExportDialog", () => {
  it("shows catalog destination and device labels while preserving filter values internally", () => {
    mockEditorState.project = parseProject({
      meta: { name: "Catalog", schemaVersion: 1 },
      fonts: [],
      preferredExportLayoutId: "default",
      layouts: [{
        id: "default",
        name: "Default",
        mode: "isolated",
        screens: [
          screen("iphone", "apple", "iphone"),
          screen("ipad", "apple", "ipad"),
          screen("watch", "apple", "watchos"),
          screen("phone", "android", "phone"),
          screen("tablet", "android", "tablet-7"),
          screen("wear", "android", "wear"),
          screen("xbox", "windows", "xbox"),
          screen("desktop", "web", "desktop"),
          screen("laptop", "web", "laptop"),
        ],
      }],
    });
    mockEditorState.activeLayoutId = "default";

    const markup = renderToStaticMarkup(React.createElement(ExportDialog, { open: true, onClose: vi.fn() }));

    for (const label of [
      "App Store",
      "Google Play",
      "Microsoft Store",
      "Web",
      "iPhone",
      "iPad",
      "watchOS",
      "Android phone",
      "7-inch Android tablet",
      "Wear OS",
      "Xbox",
      "Desktop",
      "Laptop",
    ]) expect(markup).toContain(label);
    expect(markup).toContain('<span data-value="apple">App Store</span>');
    expect(markup).toContain('<span data-value="tablet-7">7-inch Android tablet</span>');
    expect(markup).toContain('<span data-value="laptop">Laptop</span>');
    expect(markup).not.toMatch(/>apple</u);
    expect(markup).not.toMatch(/>tablet-7</u);
    expect(markup).not.toMatch(/>watchos</u);
  });
});
