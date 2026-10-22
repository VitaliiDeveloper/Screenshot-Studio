// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FontAsset } from "@screenshot-studio/core/model";

// Vitest compiles the Next.js-preserved JSX with the classic runtime for this Node-only render.
Object.assign(globalThis, { React });

import { SystemFontImportView, type SystemFontImportViewProps } from "./SystemFontImport";
import {
  filterSystemFontFamilies,
  groupSystemFontFamilies,
  SYSTEM_FONT_LICENSE_WARNING,
  type SystemFontFace,
} from "./system-font-model";

const all = { latin: true, latinExtA: true, cyrillic: true, greek: false };
const latinOnly = { latin: true, latinExtA: false, cyrillic: false, greek: false };

function face(id: string, family: string, weight: number | null, overrides: Partial<SystemFontFace> = {}): SystemFontFace {
  return { id, family, weight, style: "Regular", source: "user", format: "ttf", coverage: all, ...overrides };
}

const faces = [
  face("sf_pac", "Pacifico", 400),
  face("sf_inter4", "Inter", 400, { source: "system", coverage: latinOnly }),
  face("sf_inter7", "Inter", 700, { source: "system", coverage: latinOnly }),
  face("sf_inter9", "Inter", 900, { source: "system", coverage: latinOnly, unavailable: "The font license (Restricted License embedding) does not allow embedding" }),
  face("sf_helv", "Helvetica Neue", 400, { source: "system", format: "ttc", unavailable: "Font collections (TTC, OTC, DFont) are not supported yet" }),
];
const families = groupSystemFontFamilies(faces);

function render(overrides: Partial<SystemFontImportViewProps> = {}): string {
  const props: SystemFontImportViewProps = {
    status: "ready",
    loadError: null,
    totalFamilies: families.length,
    families,
    query: "",
    onQuery: vi.fn(),
    selectedFamily: null,
    onSelectFamily: vi.fn(),
    registered: [],
    selectedIds: new Set(),
    onToggle: vi.fn(),
    previews: {},
    busy: false,
    outcome: null,
    onImport: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  };
  return renderToStaticMarkup(React.createElement(SystemFontImportView, props));
}

const inter = families.find(({ name }) => name === "Inter")!;

describe("SystemFontImportView", () => {
  it("lists families with coverage badges behind a labelled search field", () => {
    const html = render();

    expect(html).toContain('aria-label="Search installed fonts"');
    expect(html).toContain("3 of 3 families");
    for (const name of ["Helvetica Neue", "Inter", "Pacifico"]) expect(html).toContain(name);
    expect(html).toContain("Cyrillic");
    expect(html).toContain("Latin Ext-A");
  });

  it("shows only the families that match the search", () => {
    const html = render({ query: "pac", families: filterSystemFontFamilies(families, "pac") });

    expect(html).toContain("1 of 3 families");
    expect(html).toContain("Pacifico");
    expect(html).not.toContain("Helvetica Neue");
    expect(render({ query: "zzz", families: [] })).toContain("No family matches");
  });

  it("previews Latin and Cyrillic samples through the private preview family once loaded", () => {
    const html = render({
      selectedFamily: families.find(({ name }) => name === "Pacifico")!,
      previews: { sf_pac: "ready" },
    });

    expect(html).toContain("The quick brown fox 0123");
    expect(html).toContain("Чуєш їх, доцю, га?");
    expect(html).toContain("__system-preview-sf_pac");
  });

  it("says when a face has no Cyrillic glyphs instead of rendering fallback text", () => {
    const html = render({ selectedFamily: inter, previews: { sf_inter4: "ready" } });

    expect(html).toContain("No Cyrillic glyphs to preview.");
    expect(html).not.toContain("Чуєш");
  });

  it("shows loading and failed preview states", () => {
    expect(render({ selectedFamily: inter })).toContain("Loading preview…");
    expect(render({ selectedFamily: inter, previews: { sf_inter4: "error", sf_inter7: "error" } })).toContain("Preview could not load.");
  });

  it("offers a checkbox per weight, reflects the selection, and counts it on the Import button", () => {
    const html = render({ selectedFamily: inter, selectedIds: new Set(["sf_inter4", "sf_inter7"]) });

    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
    expect(html.match(/checked=""/g)).toHaveLength(2);
    expect(html).toContain("Import 2 weights");
    expect(render({ selectedFamily: inter })).toMatch(/<button[^>]*disabled=""[^>]*>Import<\/button>/);
  });

  it("disables unavailable weights and prints the reason next to them", () => {
    const html = render({ selectedFamily: inter });

    expect(html).toContain("Restricted License embedding");
    expect(html).toMatch(/<input[^>]*disabled=""[^>]*aria-describedby="system-font-reason-sf_inter9"/);

    const collection = render({ selectedFamily: families.find(({ name }) => name === "Helvetica Neue")! });
    expect(collection).toContain("Font collections (TTC, OTC, DFont) are not supported yet");
    expect(collection).not.toContain("Loading preview");
  });

  it("disables a weight that the project already has and says so", () => {
    const registered: FontAsset[] = [{ family: "Inter", weight: 700, source: "uploaded", path: "assets/fonts/inter-700.ttf" }];
    const html = render({ selectedFamily: inter, registered });

    expect(html).toContain('Already in the project as &quot;Inter&quot; 700');
    expect(html.match(/type="checkbox"[^>]*disabled=""/g)).toHaveLength(2);
  });

  it("warns about the license for families with OS fonts and not for user fonts", () => {
    expect(render({ selectedFamily: inter })).toContain(SYSTEM_FONT_LICENSE_WARNING);
    expect(render({ selectedFamily: families.find(({ name }) => name === "Pacifico")! })).not.toContain("responsible for checking");
  });

  it("shows scanning, error and empty states", () => {
    expect(render({ status: "loading", totalFamilies: 0, families: [] })).toContain("Scanning installed fonts…");
    expect(render({ status: "error", loadError: "Installed font scan failed (500)" })).toContain("Installed font scan failed (500)");
    expect(render({ totalFamilies: 0, families: [] })).toContain("No installed fonts found");
  });

  it("shows each face's style name beside its weight", () => {
    const html = render({ selectedFamily: families.find(({ name }) => name === "Pacifico")! });

    expect(html).toMatch(/400<\/strong><span[^>]*>Regular<\/span>/);
  });

  it("disables the family buttons while an import is running", () => {
    const html = render({ busy: true });

    expect(html.match(/<button[^>]*disabled=""[^>]*><span[^>]*>Pacifico/g)).toHaveLength(1);
  });

  it("disables the controls and reports the outcome while importing", () => {
    const html = render({
      selectedFamily: inter,
      selectedIds: new Set(["sf_inter4"]),
      busy: true,
      outcome: { tone: "error", text: "Inter 700 failed: boom" },
    });

    expect(html).toContain("Importing…");
    expect(html).toContain("Inter 700 failed: boom");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*(<svg.*?<\/svg>)?\s*Back to fonts/s);
  });
});
