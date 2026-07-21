// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OutputIdentityHeader, type OutputIdentityRole } from "@web/components/editor-ui/OutputIdentityHeader.js";

// Vitest compiles the Next.js-preserved JSX with the classic runtime for this Node-only render.
Object.assign(globalThis, { React });

function render(role: OutputIdentityRole): string {
  return renderToStaticMarkup(React.createElement(OutputIdentityHeader, {
    label: "Web · Windows desktop",
    editing: role === "master",
    sizeLabel: role === "master" ? "Web desktop 1920×1080" : "Web desktop 1440×900",
    role,
  }));
}

function classNameFor(markup: string, testId: string): string {
  const tag = markup.match(new RegExp(`<[^>]+data-testid="${testId}"[^>]*>`))?.[0] ?? "";
  return tag.match(/class="([^"]+)"/)?.[1] ?? "";
}

describe("OutputIdentityHeader", () => {
  it("uses one typography and color contract for master and variant metadata", () => {
    const master = render("master");
    const variant = render("variant");

    expect(classNameFor(master, "output-identity-size")).toBe(
      classNameFor(variant, "output-identity-size"),
    );
    expect(classNameFor(master, "output-identity-role")).toBe(
      classNameFor(variant, "output-identity-role"),
    );
    expect(master).toContain("Web desktop 1920×1080");
    expect(master).toContain("master");
    expect(variant).toContain("Web desktop 1440×900");
    expect(variant).toContain("variant");
  });

  it("uses editor semantic tokens instead of literal palette classes", () => {
    const markup = render("master");

    expect(markup).toContain("var(--editor-font-label-size)");
    expect(markup).toContain("var(--editor-color-text-muted)");
    expect(markup).toContain("var(--editor-color-surface-muted)");
    expect(markup).not.toMatch(/text-slate-|bg-slate-|text-blue-|bg-blue-/);
  });
});
