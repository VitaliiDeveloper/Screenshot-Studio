// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OutputFamilySection } from "./OutputFamilySection.js";

// Vitest compiles the Next.js-preserved JSX with the classic runtime for this Node-only render.
Object.assign(globalThis, { React });

describe("OutputFamilySection", () => {
  it("keeps editing in the title row and puts size metadata on its own row", () => {
    const markup = renderToStaticMarkup(React.createElement(OutputFamilySection, {
      label: "Web · Windows desktop",
      editing: true,
      artworkWidth: 220,
      sizeLabel: "Web desktop 1920×1080",
      role: "master",
      children: React.createElement("div", null, "Artwork"),
    }));

    const titleRow = markup.match(/data-testid="output-identity-title-row"[^>]*>(.*?)<\/div>/)?.[1] ?? "";
    const metaRow = markup.match(/data-testid="output-identity-meta-row"[^>]*>(.*?)<\/div>/)?.[1] ?? "";
    expect(titleRow).toContain("Web · Windows desktop");
    expect(titleRow).toContain("Editing");
    expect(titleRow).not.toContain("1920×1080");
    expect(metaRow).toContain("Web desktop 1920×1080");
    expect(metaRow).toContain("master");
    expect(metaRow).not.toContain("Editing");
  });
});
