// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ProjectHome.tsx", import.meta.url), "utf8");
const modelSource = readFileSync(new URL("../../lib/project-home-model.ts", import.meta.url), "utf8");
const completeSource = `${source}\n${modelSource}`;

describe("ProjectHome overview", () => {
  it("loads the validated project projection and renders shared-renderer previews", () => {
    expect(source).toContain("loadProjectHomeData");
    expect(source).toContain("buildProjectHomeSummary");
    expect(source).toContain("DynamicScreenThumbnail");
    expect(source).toContain("Representative previews");
  });

  it("offers the explicitly named archive action only through its capability", () => {
    expect(source).toContain("project-archive-export");
    expect(source).not.toContain('project.sourceKind === "managed-project"');
    expect(source).toContain("Export project archive");
    expect(source).toContain("requestProjectArchive");
    expect(source).toContain("requestProjectArchive(data.selection.projectId)");
    expect(source).toContain("downloadProjectArchive");
  });

  it("uses the same capability projection for header actions and scopes prior save errors", () => {
    expect(source).toContain('action.id === "continue-editing"');
    expect(source).toContain('action.id === "import-project"');
    expect(source).toContain("getProjectPersistenceIdentity()?.projectId === data.selection.projectId");
  });

  it("keeps project archive and rendered store-image export unambiguous", () => {
    expect(source).toContain("portable backup for later project import");
    expect(source).toContain("separate from rendered store-image export");
    expect(source).toContain('role="alert"');
  });

  it("covers the complete informational and action-oriented contract", () => {
    for (const copy of [
      "Preferred export layout",
      "Supported platforms",
      "Locales",
      "Output families and store targets",
      "Readiness",
      "Continue in Workspace",
      "Manage layouts and screens",
      "Add a screen",
      "Manage locales",
      "Import another project",
      "Export store images",
    ]) expect(completeSource).toContain(copy);
  });

  it("distinguishes the launcher and authoring terms without promising capture import", () => {
    for (const term of [
      "Project templates",
      "Screen templates",
      "Layout modes",
      "Project import",
      "Capture import",
      "Project archive export",
      "Store-image export",
    ]) expect(source).toContain(term);
  });
});
