// SPDX-License-Identifier: Apache-2.0
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToolbarIssuesButton, toolbarIssuesLabel } from "./ToolbarIssuesButton";

function renderIssues(blockers: number, warnings: number, compact = false) {
  return renderToStaticMarkup(createElement(ToolbarIssuesButton, {
    issueCounts: { blockers, warnings },
    compact,
    labelClassName: "label",
    onOpen: () => {},
  }));
}

describe("ToolbarIssuesButton", () => {
  it("summarises open issues in its accessible label", () => {
    expect(toolbarIssuesLabel({ blockers: 0, warnings: 0 })).toBe("Issues: none");
    expect(toolbarIssuesLabel({ blockers: 1, warnings: 2 })).toBe("Issues: 1 blocker · 2 warnings");
  });

  it("shows the total only when issues are open", () => {
    expect(renderIssues(0, 0)).not.toContain("tabular-nums");
    expect(renderIssues(1, 2)).toMatch(/tabular-nums[^>]*>3</);
  });

  it("tints by the most severe open level", () => {
    expect(renderIssues(1, 2)).toContain("danger-surface");
    expect(renderIssues(0, 2)).toContain("warning-surface");
    expect(renderIssues(0, 2)).not.toContain("danger-surface");
    expect(renderIssues(0, 0)).not.toMatch(/danger-surface|warning-surface/);
  });

  it("drops the icon-label gap when compact", () => {
    expect(renderIssues(1, 0, true)).toContain("!gap-0");
    expect(renderIssues(1, 0, true)).toContain("ml-1.5");
    expect(renderIssues(1, 0, false)).not.toContain("!gap-0");
  });
});
