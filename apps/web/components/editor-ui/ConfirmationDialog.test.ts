// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConfirmationDialog } from "./ConfirmationDialog.js";

// Vitest compiles the Next.js-preserved JSX with the classic runtime for this Node-only render.
Object.assign(globalThis, { React });

describe("ConfirmationDialog", () => {
  it("renders an app-owned accessible confirmation with explicit actions", () => {
    const markup = renderToStaticMarkup(React.createElement(ConfirmationDialog, {
      title: "Remove size variant?",
      description: "The master stays unchanged.",
      confirmLabel: "Remove variant",
      onConfirm: vi.fn(),
      onClose: vi.fn(),
    }));

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("Remove size variant?");
    expect(markup).toContain("The master stays unchanged.");
    expect(markup).toContain("Cancel");
    expect(markup).toContain("Remove variant");
    expect(markup).toContain("max-w-xs");
    expect(markup).toContain("text-sm");
    expect(markup).toContain("bg-[var(--editor-color-danger)]");
    expect(markup).toContain("!text-xs");
    expect(markup).toContain("whitespace-nowrap");
  });

  it("keeps native blocking dialogs out of editor actions", () => {
    const sources = [
      "../editor-shell/SizesBar.tsx",
      "../ScreensSection.tsx",
      "../LayoutSelector.tsx",
      "../LocaleManagerDialog.tsx",
    ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));

    for (const source of sources) {
      expect(source).not.toMatch(/window\.(confirm|alert|prompt)\s*\(/);
      expect(source).toContain("ConfirmationDialog");
    }
  });
});
