// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SizeRowHeader } from "./SizeRowHeader.js";

// Vitest compiles the Next.js-preserved JSX with the classic runtime for this Node-only render.
Object.assign(globalThis, { React });

describe("SizeRowHeader", () => {
  it("keeps the family and editing state above size and variant metadata", () => {
    const markup = renderToStaticMarkup(React.createElement(SizeRowHeader, {
      label: "Web · Windows desktop",
      sizeLabel: "Web desktop 1440×900",
      editing: true,
    }));

    const titleRow = markup.match(/data-testid="output-identity-title-row"[^>]*>(.*?)<\/div>/)?.[1] ?? "";
    const metaRow = markup.match(/data-testid="output-identity-meta-row"[^>]*>(.*?)<\/div>/)?.[1] ?? "";
    expect(titleRow).toContain("Web · Windows desktop");
    expect(titleRow).toContain("Editing");
    expect(titleRow).not.toContain("1440×900");
    expect(metaRow).toContain("Web desktop 1440×900");
    expect(metaRow).toContain("variant");
    expect(metaRow).not.toContain("Editing");
  });
});
