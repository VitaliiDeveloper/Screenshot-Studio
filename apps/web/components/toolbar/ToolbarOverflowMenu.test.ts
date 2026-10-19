// SPDX-License-Identifier: Apache-2.0
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  initialOverflowMenuFocusEdge,
  TOOLBAR_OVERFLOW_MENU_ITEM_SELECTOR,
  ToolbarOverflowMenu,
} from "./ToolbarOverflowMenu";

function renderOverflow(
  density: "overflow-secondary" | "overflow-locale" | "minimal",
  inspectorOpen: boolean,
) {
  return renderToStaticMarkup(
    createElement(ToolbarOverflowMenu, {
      density,
      open: true,
      onOpenChange: () => {},
      triggerRef: createRef<HTMLButtonElement>(),
      inspectorOpen,
      activeLocale: "en",
      localeOptions: [
        { value: "en", label: "Locale · en" },
        { value: "uk", label: "Locale · uk" },
      ],
      onToggleInspector: () => {},
      onLocaleChange: () => {},
      canUndo: true,
      canRedo: false,
      onUndo: () => {},
      onRedo: () => {},
    }),
  );
}

describe("ToolbarOverflowMenu", () => {
  it("uses controlled open state", () => {
    const markup = renderOverflow("overflow-secondary", false);

    expect(markup).toContain('aria-expanded="true"');
    expect(markup).not.toContain('hidden=""');
  });

  it("preserves Inspector toggle semantics in overflow", () => {
    expect(renderOverflow("overflow-secondary", true)).toContain(
      'role="menuitemcheckbox" aria-checked="true"',
    );
    expect(renderOverflow("overflow-secondary", false)).toContain(
      'role="menuitemcheckbox" aria-checked="false"',
    );
  });

  it.each([
    ["pointer", "first"],
    ["ArrowDown", "first"],
    ["Home", "first"],
    ["ArrowUp", "last"],
    ["End", "last"],
  ] as const)("opens from %s at the %s item", (intent, edge) => {
    expect(initialOverflowMenuFocusEdge(intent)).toBe(edge);
  });

  it("uses every supported menu-item role for focus and navigation", () => {
    expect(TOOLBAR_OVERFLOW_MENU_ITEM_SELECTOR).toBe(
      "[role='menuitem'], [role='menuitemcheckbox'], [role='menuitemradio']",
    );
  });

  it("keeps secondary actions in both overflow densities", () => {
    expect(renderOverflow("overflow-secondary", true)).toContain("Hide Inspector");
  });

  it("only includes locale choices in locale overflow", () => {
    expect(renderOverflow("overflow-secondary", true)).not.toContain("Locale · en");
    expect(renderOverflow("overflow-locale", false)).toContain("Locale · en");
    expect(renderOverflow("overflow-locale", false)).toContain('role="menuitemradio"');
  });

  it("keeps locale radio semantics and a 28px trigger in minimal density", () => {
    const markup = renderOverflow("minimal", false);

    expect(markup).toContain("Locale · en");
    expect(markup).toContain('role="menuitemradio" aria-checked="true"');
    expect(markup).toContain("h-7 w-7");
    expect(markup).not.toContain("h-8 w-8");
  });

  it("moves undo and redo into the minimal overflow without exposing them earlier", () => {
    const minimal = renderOverflow("minimal", false);

    expect(minimal).toContain(">Undo<");
    expect(minimal).toContain(">Redo<");
    expect(minimal).toContain('aria-disabled="true"');
    expect(renderOverflow("overflow-locale", false)).not.toContain(">Undo<");
  });
});
