// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ProjectHome.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../../app/home/page.tsx", import.meta.url), "utf8");
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

  it("opens capture import from the established Project Home action boundary", () => {
    expect(source).toContain('action.id === "capture-import"');
    expect(source).toContain("CaptureImportDialog");
    expect(source).toContain("openCaptureImport");
    expect(source).toContain("currentCaptureTarget");
    expect(source).toContain("applyEditorResourceResult");
    expect(source).toContain("reloadProjectHome");
    expect(source).toContain("assertCaptureImportHandoff");
    expect(source).not.toContain("_result: unknown");
    expect(source).toContain("const recoverCaptureTarget = useCallback(async () =>");
    expect(source).toContain("await reloadProjectHome()");
    expect(source).toContain("assertCaptureImportRecoveryTarget(loaded)");
    expect(pageSource).toContain("searchParams");
    expect(pageSource).toContain("expectedProjectId");
    expect(source).toContain("expectedProjectId?: string");
    expect(source).toContain("loaded.selection.projectId !== expectedProjectId");
  });

  it("keeps project archive and rendered store-image export unambiguous", () => {
    expect(source).toContain("portable backup for later project import");
    expect(source).toContain("separate from rendered store-image export");
    expect(source).toContain('role="alert"');
  });

  it("closes only the active session behind the shared save fence", () => {
    expect(source).toContain("closeProjectSession");
    expect(source).toContain("Close project");
    expect(source).toContain('router.push("/?switch=1")');
    expect(source).toContain("closeError");
    expect(source).not.toContain("deleteManagedProject");
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

  it("distinguishes capture-folder import from complete project import", () => {
    for (const term of [
      "Project templates",
      "Screen templates",
      "Component presets",
      "Layout modes",
      "Project import",
      "Capture import",
      "Project archive export",
      "Store-image export",
    ]) expect(source).toContain(term);
    expect(source).toContain("available from Create project on App Home");
    expect(source).toContain("Previews raw PNG capture folders before adding them");
    expect(source).not.toContain("not this launcher slice");
  });
});
