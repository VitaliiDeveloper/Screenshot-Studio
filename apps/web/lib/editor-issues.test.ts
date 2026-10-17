// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { createTextElement, parseProject, type Element } from "@screenshot-studio/core/model";
import { collectLayoutIssues, type ProjectIssue } from "@screenshot-studio/core/validation";
import { countIssues, issueRowCopy, issueSummary } from "./editor-issues";

function screen(id: string, name: string, locale: string, elements: Element[] = []) {
  return {
    id,
    name,
    platform: "apple",
    device: "iphone",
    locale,
    artboard: { width: 1320, height: 2868 },
    background: { type: "solid", color: "#101827" },
    elements,
  };
}

const project = parseProject({
  meta: { name: "T", schemaVersion: 1 },
  fonts: [],
  preferredExportLayoutId: "default",
  layouts: [{
    id: "default",
    name: "Default",
    mode: "isolated",
    screens: [
      screen("hero", "Hero", "en", [{ ...createTextElement({}), id: "title", name: "Headline" }]),
      screen("details", "Stay Organized", "en"),
      screen("hero-de", "Hero", "de"),
    ],
  }],
});

describe("editor issues copy", () => {
  const issues = collectLayoutIssues(project, "default", { textOverflows: () => true });

  it("summarizes blockers and warnings", () => {
    expect(countIssues(issues)).toEqual({ blockers: 1, warnings: 1 });
    expect(issueSummary({ blockers: 3, warnings: 1 })).toBe("3 blockers · 1 warning");
    expect(issueSummary({ blockers: 0, warnings: 2 })).toBe("2 warnings");
    expect(issueSummary({ blockers: 0, warnings: 0 })).toBe("No issues");
  });

  it("names the screen, scope, and fix for each issue", () => {
    const [missing, overflow] = issues.map((issue) => issueRowCopy(project, issue));

    expect(missing).toEqual({
      title: "Screen missing in locale de",
      detail: expect.stringMatching(/^Stay Organized · iPhone/),
      fixLabel: "Create from en",
    });
    expect(overflow).toEqual({
      title: "Text overflows its layer box",
      detail: expect.stringMatching(/^Headline · Hero · iPhone.* · en$/),
      fixLabel: "Fit text",
    });
  });

  it("drops an issue whose target no longer exists", () => {
    const overflow = issues.find((issue): issue is Extract<ProjectIssue, { kind: "text-overflow" }> =>
      issue.kind === "text-overflow"
    )!;
    expect(issueRowCopy(project, { ...overflow, elementId: "gone" })).toBeNull();
  });
});
