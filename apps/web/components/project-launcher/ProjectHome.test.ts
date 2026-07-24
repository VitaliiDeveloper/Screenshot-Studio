// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ProjectHome.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../../app/home/page.tsx", import.meta.url), "utf8");
const modelSource = readFileSync(new URL("../../lib/project-home-model.ts", import.meta.url), "utf8");
const thumbnailSource = readFileSync(new URL("../ScreenThumbnail.tsx", import.meta.url), "utf8");

describe("Project Info overview", () => {
  it("loads the validated project projection and leads with shared-renderer previews", () => {
    expect(source).toContain("loadProjectHomeData");
    expect(source).toContain("buildProjectHomeSummary");
    expect(source).toContain("DynamicScreenThumbnail");
    expect(source).toContain('id="project-screens"');
    expect(source.indexOf('id="project-screens"')).toBeLessThan(source.indexOf('id="project-layouts"'));
    expect(source.indexOf('id="project-screens"')).toBeLessThan(source.indexOf('id="project-outputs"'));
  });

  it("keeps Project Info compact with one primary editor action and a distinct archive action", () => {
    expect(source).toContain("Open in Editor");
    expect(source).toContain("Export archive");
    expect(source.indexOf("{continueAction?.enabled")).toBeLessThan(source.indexOf("{archiveAction?.enabled"));
    expect(source).toContain('<span className="text-[13px]">');
    expect(source).toContain("requestProjectArchive(data.selection.projectId, data.resources.revision)");
    expect(source).toContain("downloadProjectArchive(ticket)");
    expect(source).toContain('href="/"');
    expect(source).toContain("Projects");
    expect(source).not.toContain("Next actions");
    expect(source).not.toContain("Workflow guide");
    expect(source).not.toContain("Import another project");
    expect(source).not.toContain("Continue in Workspace");
    expect(source).not.toContain("No known blockers");
  });

  it("shows only actual issues and keeps source-safe project identity", () => {
    expect(source).toContain("summary.readiness.length > 0");
    expect(source).toContain("Project issues");
    expect(source).toContain("summary.source.label");
    expect(source).toContain("summary.source.location");
    expect(modelSource).not.toContain('selection.sourceKind === "managed-project"\n    && selection.displayLocation');
  });

  it("preserves the unique close-session action in a quiet overflow", () => {
    expect(source).toContain('aria-label="Project info actions"');
    expect(source).toContain("closeProjectSession");
    expect(source).toContain("Close project");
    expect(source).toContain('router.push("/?switch=1")');
    expect(source).toContain("closeError");
    expect(source).not.toContain("deleteManagedProject");
  });

  it("renders mixed output families in equal, uncropped preview stages with stable identities", () => {
    expect(modelSource).toContain(".slice(0, 4)");
    expect(modelSource).toContain("screen.platform}/${screen.device}");
    expect(modelSource).toContain("screen.elements.length > 0");
    expect(modelSource).toContain("outputLabel: storeOutputLabel");
    expect(modelSource).toContain("width: screen.artboard.width");
    expect(modelSource).toContain("height: screen.artboard.height");
    expect(source).toContain('key={`${screen.layoutId}/${screen.screenId}`}');
    expect(source).toContain('fit="contain"');
    expect(source).toContain('h-[26rem]');
    expect(thumbnailSource).toContain("screenThumbnailPixelRatio");
    expect(thumbnailSource).toContain("window.devicePixelRatio");
    expect(source).not.toContain("aspectRatio:");
  });

  it("fences a stale Project Info request to its expected project id", () => {
    expect(pageSource).toContain("searchParams");
    expect(pageSource).toContain("expectedProjectId");
    expect(pageSource).toContain("expectedEntryId");
    expect(source).toContain("expectedProjectId?: string");
    expect(source).toContain("expectedEntryId?: string");
    expect(source).toContain("projectInfoEntryBindingError(expectedProjectId, expectedEntryId)");
    expect(source).toContain("loaded.selection.projectId !== expectedProjectId");
  });
});
