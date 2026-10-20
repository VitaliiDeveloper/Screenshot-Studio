// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  createImageElement,
  createScreenshotElement,
  createShapeElement,
  createTextElement,
  parseProject,
  type Element,
} from "@screenshot-studio/core/model";
import { collectLayoutIssues, type ProjectIssue } from "@screenshot-studio/core/validation";
import {
  countIssues,
  issueRowCopy,
  issueSummary,
  missingProjectImages,
  textSizeStatus,
} from "./editor-issues";

function screen(id: string, name: string, locale: string, elements: Element[] = []) {
  return {
    id,
    name,
    platform: "apple",
    device: "iphone",
    locale,
    artboard: { width: 1206, height: 2622 },
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

  it("names an unnamed text layer by its text, as the layers tree does", () => {
    const overflow = issues.find((issue): issue is Extract<ProjectIssue, { kind: "text-overflow" }> =>
      issue.kind === "text-overflow"
    )!;
    const unnamed = parseProject({
      ...project,
      layouts: [{
        ...project.layouts[0]!,
        screens: project.layouts[0]!.screens.map((candidate) => candidate.id === "hero"
          ? { ...candidate, elements: [{ ...createTextElement({}), id: "title", content: "Fast,\nreliable shipping" }] }
          : candidate),
      }],
    });
    expect(issueRowCopy(unnamed, overflow)?.detail).toMatch(/^Fast, reliable shipping · Hero · iPhone/);
  });

  it("drops an issue whose target no longer exists", () => {
    const overflow = issues.find((issue): issue is Extract<ProjectIssue, { kind: "text-overflow" }> =>
      issue.kind === "text-overflow"
    )!;
    expect(issueRowCopy(project, { ...overflow, elementId: "gone" })).toBeNull();
  });
});

describe("missing-image issues", () => {
  const media = parseProject({
    meta: { name: "M", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [{
      id: "default",
      name: "Default",
      mode: "isolated",
      screens: [
        {
          ...screen("hero", "Hero", "en", [
            { ...createScreenshotElement({ assetUrl: "assets/gone.png" }), id: "shot", name: "App screen" },
            { ...createImageElement({ assetUrl: "assets/hidden.png" }), id: "hidden", visible: false },
          ]),
          background: { type: "image", assetUrl: "assets/gone-bg.png", fit: "cover", color: "#000000" },
        },
      ],
    }, {
      id: "second",
      name: "Second",
      mode: "isolated",
      screens: [screen("other", "Other", "en", [
        { ...createImageElement({ assetUrl: "assets/gone.png" }), id: "again" },
      ])],
    }],
  });
  const images = new Map([["assets/kept.png", {} as HTMLImageElement]]);
  const issues = collectLayoutIssues(media, "default", { imageMissing: (assetUrl) => !images.has(assetUrl) });

  it("names the file, the layer or background, and Replace", () => {
    expect(issues.map((issue) => issueRowCopy(media, issue))).toEqual([
      {
        title: "Image missing from the project folder",
        detail: expect.stringMatching(/^assets\/gone-bg\.png · Background · Hero · iPhone/),
        fixLabel: "Replace",
      },
      {
        title: "Image missing from the project folder",
        detail: expect.stringMatching(/^assets\/gone\.png · App screen · Hero · iPhone/),
        fixLabel: "Replace",
      },
    ]);
  });

  it("lists each missing project image once across layouts for project readiness", () => {
    expect(missingProjectImages(media, images)).toEqual(["assets/gone-bg.png", "assets/gone.png"]);
  });
});

describe("textSizeStatus", () => {
  function variant(id: string, storeTargetId: string, elements: Element[]) {
    return {
      ...screen(id, "Hero", "en", elements),
      artboard: { width: 1320, height: 2868 },
      variantOf: "hero",
      storeTargetId,
    };
  }
  const title = (id: string, visible = true) => ({ ...createTextElement({}), id, visible });
  const slot = parseProject({
    meta: { name: "S", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [{
      id: "default",
      name: "Default",
      mode: "isolated",
      screens: [
        screen("hero", "Hero", "en", [title("title"), title("subtitle")]),
        variant("hero-69", "6.9", [title("title-69"), title("subtitle-69")]),
        variant("hero-61", "6.1", [title("title-61"), title("subtitle-61", false)]),
        variant("hero-65", "6.5", [title("subtitle-65"), { ...createShapeElement({}), id: "added" }]),
      ],
    }],
  });
  const overflowing = new Set(["title-69"]);
  const issues = collectLayoutIssues(slot, "default", {
    textOverflows: (element) => overflowing.has(element.id),
  });
  const rows = (elementId: string, measured = true) => textSizeStatus(slot, "default", "hero", elementId, issues, measured)
    .map(({ label, current, element, state }) => ({ label, current, element: element?.id ?? null, state }));

  it("reads each exact size of the slot from the Issues list", () => {
    expect(rows("title")).toEqual([
      { label: "6.3\" · Portrait", current: true, element: "title", state: "fits" },
      { label: "6.9\" · Portrait", current: false, element: "title-69", state: "overflows" },
      { label: "5.8\" · Portrait", current: false, element: "title-61", state: "fits" },
      { label: "6.5\" · Portrait", current: false, element: null, state: "unmatched" },
    ]);
    expect(rows("subtitle")[2]).toEqual({ label: "5.8\" · Portrait", current: false, element: "subtitle-61", state: "hidden" });
  });

  it("never reports fits before text has been measured", () => {
    expect(rows("title", false).map(({ state }) => state)).toEqual(["checking", "checking", "checking", "unmatched"]);
  });

  // Regression: the diverged 6.5" screen holds a text layer at the selected layer's index, but a
  // guessed match would let Fit resize the wrong layer.
  it("never matches a layer once a size's structure diverged", () => {
    expect(rows("title")[3]?.element).toBeNull();
  });

  it("tells sizes that share a label apart by artboard px", () => {
    const lead = parseProject({
      ...slot,
      layouts: [{
        ...slot.layouts[0]!,
        screens: [
          { ...screen("hero", "Hero", "en", [title("title")]), artboard: { width: 603, height: 1311 } },
          { ...variant("hero-63", "6.3", [title("title-63")]), artboard: { width: 1206, height: 2622 } },
          variant("hero-69", "6.9", [title("title-69")]),
        ],
      }],
    });
    expect(textSizeStatus(lead, "default", "hero", "title", [], true).map(({ label }) => label)).toEqual([
      "6.3\" · Portrait · 603 × 1311",
      "6.3\" · Portrait · 1206 × 2622",
      "6.9\" · Portrait",
    ]);
  });
});
