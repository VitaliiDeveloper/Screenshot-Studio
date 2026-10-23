// SPDX-License-Identifier: Apache-2.0
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  editorUi,
  DialogShell,
  InsetPanel,
  MenuSelect,
  SegmentedControl,
  StatusMessage,
  ToolButton,
  WrapAtSeparators,
} from "@web/components/editor-ui.js";

const menuSelectSource = readFileSync(new URL("./MenuSelect.tsx", import.meta.url), "utf8");
const addMenuSource = readFileSync(new URL("./AddMenu.tsx", import.meta.url), "utf8");
const emptyResourceStateSource = readFileSync(new URL("./EmptyResourceState.tsx", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

describe("editor UI primitives", () => {
  it("associates visible dialog descriptions with the modal semantics", () => {
    const html = renderToStaticMarkup(createElement(
      DialogShell,
      {
        title: "Import project",
        description: "The selected source stays unchanged.",
        onClose: () => undefined,
        children: "Dialog body",
      },
    ));
    const descriptionId = html.match(/aria-describedby="([^"]+)"/)?.[1];

    expect(descriptionId).toBeTruthy();
    expect(html).toContain(`id="${descriptionId}"`);
    expect(html).toContain("The selected source stays unchanged.");
  });

  it("uses semantic tokens for every shared visual category", () => {
    const contracts = Object.values(editorUi).join(" ");

    for (const category of [
      "color",
      "space",
      "radius",
      "font",
      "shadow",
      "focus",
      "motion",
    ]) {
      expect(contracts).toContain(`var(--editor-${category}-`);
    }
    expect(contracts).not.toMatch(/(?:slate|blue|red|amber)-\d/);
  });

  it("provides complete contracts for recurring active and destructive states", () => {
    const contracts = editorUi as Record<string, string>;

    for (const variant of [
      "buttonGhostAccent",
      "buttonGhostActive",
      "iconButtonActive",
      "iconButtonDanger",
    ]) {
      expect(contracts[variant]).toContain("var(--editor-color-");
    }
    expect(contracts.rowIconButtonDanger)
      .toContain("text-[color:var(--editor-color-danger)]");
  });

  it("keeps segmented choices visually compact", () => {
    expect(editorUi.segmentedControl).toContain("shrink-0");
    expect(editorUi.segmentedControl).toContain("rounded-lg");
    expect(editorUi.segmentedControl).toContain("var(--editor-color-surface-muted)");
    expect(editorUi.segmentedButton).toContain("h-6");
    expect(editorUi.segmentedButton).toContain("font-medium");
    expect(editorUi.segmentedButton).toContain("whitespace-nowrap");
    expect(editorUi.segmentedButtonDefault).toContain("px-2.5");
    expect(editorUi.segmentedButtonCompact).toContain("min-w-0");
    expect(editorUi.segmentedButtonLabel).toContain("inline-flex");
    expect(editorUi.segmentedButtonLabel).toContain("items-center");
    expect(editorUi.segmentedButtonLabel).toContain("gap-1.5");
    expect(editorUi.segmentedButtonActive).toContain("var(--editor-color-surface)");
    expect(editorUi.segmentedButtonActive).toContain("var(--editor-shadow-control)");
  });

  it("keeps shared menus on semantic colors and named typography variants", () => {
    const html = renderToStaticMarkup(createElement(MenuSelect, {
      ariaLabel: "Theme role",
      value: "heading",
      textSize: "emphasis",
      options: [
        { value: "heading", label: "Heading" },
        { value: "body", label: "Body" },
      ],
      onChange: () => undefined,
    }));

    expect(html).toContain("var(--editor-font-control-emphasis-size)");
    expect(html).toContain("var(--editor-color-border)");
    for (const source of [menuSelectSource, addMenuSource, emptyResourceStateSource]) {
      expect(source).not.toMatch(/(?:slate|blue|red|amber)-\d/);
    }
    expect(menuSelectSource).not.toContain("fontSize");
  });

  it("wraps long labels between parts only when asked", () => {
    const trigger = (wrapLabels: boolean) => renderToStaticMarkup(createElement(MenuSelect, {
      ariaLabel: "Apply to",
      value: "screen",
      options: [{ value: "screen", label: "Only Dynamic Island · Medium · Landscape" }],
      onChange: () => undefined,
      wrapLabels,
    }));

    expect(trigger(true)).toContain('<span class="whitespace-nowrap">Landscape</span>');
    expect(trigger(true)).toContain("min-h-8");
    expect(trigger(true)).not.toContain("truncate");
    expect(trigger(false)).toContain("truncate");
    expect(trigger(false)).toContain("h-8");
  });

  it("leaves the control font reset to layered preflight so text utilities apply", () => {
    // Unlayered CSS outranks every Tailwind utility; preflight already resets control fonts in @layer base.
    expect(globalStyles).not.toMatch(/font:\s*inherit/);
  });

  it("uses one thin range contract across inspector sliders", () => {
    expect(editorUi.rangeInput).toContain("editor-range");
    expect(editorUi.rangeInput).toContain("h-6");
    expect(editorUi.rangeInput).toContain("var(--editor-color-focus)");
  });

  it("renders a reusable accessible segmented control", () => {
    const html = renderToStaticMarkup(createElement(SegmentedControl, {
      label: "View mode",
      value: "overview",
      fill: true,
      options: [
        { value: "focus", label: "Focus" },
        { value: "overview", label: "Overview" },
      ],
      onChange: () => undefined,
    }));

    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="View mode"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain(editorUi.segmentedControlFill);
    expect(html).toContain(editorUi.segmentedButtonActive);
    expect(html).toContain(`<span class="${editorUi.segmentedButtonLabel}">Overview</span>`);

    const compactHtml = renderToStaticMarkup(createElement(SegmentedControl, {
      label: "Text alignment",
      value: "center",
      compact: true,
      options: [
        { value: "left", label: "Left" },
        { value: "center", label: "Center" },
        { value: "right", label: "Right" },
      ],
      onChange: () => undefined,
    }));

    expect(compactHtml).toContain(editorUi.segmentedButtonCompact);
    expect(compactHtml).not.toContain(editorUi.segmentedButtonDefault);
  });

  it("renders rail buttons with a visible caption and an accessible pressed state", () => {
    const tool = renderToStaticMarkup(createElement(
      ToolButton,
      { label: "Select tool", caption: "Select", active: true },
      "icon",
    ));
    const panel = renderToStaticMarkup(createElement(
      ToolButton,
      { label: "Structure panel", active: false },
      "Structure",
    ));

    expect(tool).toContain('type="button"');
    expect(tool).toContain('aria-label="Select tool"');
    expect(tool).toContain('aria-pressed="true"');
    expect(tool).toContain("<span>Select</span>");
    expect(tool).toContain(editorUi.toolButtonActive);
    expect(tool).not.toContain(editorUi.toolButtonInactive);
    expect(panel).toContain('aria-pressed="false"');
    expect(panel).not.toContain(editorUi.toolButtonActive);
    expect(panel).toContain(editorUi.toolButtonInactive);
  });

  it("assigns status roles from tone while preserving class extensions", () => {
    const error = renderToStaticMarkup(createElement(
      StatusMessage,
      { tone: "error", className: "mt-4" },
      "Could not load",
    ));
    const warning = renderToStaticMarkup(createElement(
      StatusMessage,
      { tone: "warning" },
      "Check this value",
    ));

    expect(error).toContain('role="alert"');
    expect(error).toContain(editorUi.statusError);
    expect(error).toContain("mt-4");
    expect(warning).toContain('role="status"');
    expect(warning).toContain(editorUi.statusWarning);
  });

  it("renders the shared inspector inset surface", () => {
    const html = renderToStaticMarkup(createElement(
      InsetPanel,
      { className: "extra" },
      "Inspector controls",
    ));

    expect(html).toContain(editorUi.insetPanel);
    expect(html).toContain("extra");
    expect(html).toContain("Inspector controls");
  });
});

describe("WrapAtSeparators", () => {
  it("keeps each part unbroken and shows a trailing device count as a chip", () => {
    const markup = renderToStaticMarkup(createElement(WrapAtSeparators, { text: "iPhone 18 Pro · 17 Pro · 17 +5" }));
    expect(markup.match(/whitespace-nowrap/g)).toHaveLength(3);
    expect(markup).toMatch(/17 <span class="inline-block rounded-full[^"]*">\+5<\/span>/);
    expect(renderToStaticMarkup(createElement(WrapAtSeparators, { text: "1206 × 2622 px" }))).not.toContain("rounded-full");
  });
});
