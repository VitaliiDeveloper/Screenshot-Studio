// SPDX-License-Identifier: Apache-2.0
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  editorUi,
  InsetPanel,
  SegmentedControl,
  StatusMessage,
  ToolButton,
} from "../editor-ui.js";

describe("editor UI primitives", () => {
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
    expect(editorUi.segmentedButton).toContain("px-2.5");
    expect(editorUi.segmentedButton).toContain("font-medium");
    expect(editorUi.segmentedButton).toContain("whitespace-nowrap");
    expect(editorUi.segmentedButtonLabel).toBe("text-xs leading-none");
    expect(editorUi.segmentedButtonActive).toContain("var(--editor-color-surface)");
    expect(editorUi.segmentedButtonActive).toContain("var(--editor-shadow-control)");
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
  });

  it("renders tool and panel buttons with an accessible pressed state", () => {
    const tool = renderToStaticMarkup(createElement(
      ToolButton,
      { label: "Select tool", active: true, variant: "tool" },
      "Select",
    ));
    const panel = renderToStaticMarkup(createElement(
      ToolButton,
      { label: "Structure panel", active: false, variant: "panel" },
      "Structure",
    ));

    expect(tool).toContain('type="button"');
    expect(tool).toContain('aria-label="Select tool"');
    expect(tool).toContain('aria-pressed="true"');
    expect(tool).toContain(editorUi.toolButtonToolActive);
    expect(tool).not.toContain(editorUi.toolButtonInactive);
    expect(panel).toContain('aria-pressed="false"');
    expect(panel).not.toContain(editorUi.toolButtonPanelActive);
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
