// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const screenTemplateDialog = readFileSync(
  new URL("../TemplateLibraryDialog.tsx", import.meta.url),
  "utf8",
);
const workspaceModel = readFileSync(
  new URL("../../lib/editor-workspace.ts", import.meta.url),
  "utf8",
);
const screensSection = readFileSync(new URL("../ScreensSection.tsx", import.meta.url), "utf8");
const leftPanel = readFileSync(new URL("../LeftPanel.tsx", import.meta.url), "utf8");
const editorPage = readFileSync(new URL("../../app/editor/page.tsx", import.meta.url), "utf8");
const captureImportHook = readFileSync(
  new URL("../../app/editor/use-editor-capture-import.ts", import.meta.url),
  "utf8",
);

describe("project creation terminology", () => {
  it("names project-local screen starters as screen templates throughout the Workspace UI", () => {
    for (const copy of [
      'title="Screen templates"',
      "from a project-local screen template",
      'ariaLabel="Screen template library"',
      "Loading screen templates",
      'title="No screen templates yet"',
    ]) expect(screenTemplateDialog).toContain(copy);
    expect(screenTemplateDialog).not.toContain("from a project template");
  });

  it("does not label the screen-template action as project templates or component presets", () => {
    expect(workspaceModel).toContain('label: "Screen templates"');
    expect(workspaceModel).toContain('hint: "Create a screen from a project-local screen template"');
    expect(workspaceModel).not.toContain('hint: "Project templates"');
    expect(screensSection).toContain('label: "From screen template"');
    expect(screensSection).toContain('description: "Create from a screen template"');
    expect(screensSection).not.toContain("Create from a project template");
    expect(leftPanel).toContain('title="Screen templates"');
  });

  it("makes the blank-screen onboarding actions explicit", () => {
    expect(screensSection).toContain("Your blank screen is ready");
    expect(screensSection).toContain("create a new editable screen from a built-in template");
    expect(screensSection).toContain("Create from template");
    expect(screensSection).toContain("onClick={onImportCaptures}");
    expect(screensSection).toContain("Import capture folder");
    expect(screensSection).toContain("Keep blank screen");
    expect(screensSection).toContain("setDismissedOnboardingScreenId");
    expect(screensSection).not.toContain("Start blank");
    expect(captureImportHook).toContain("useCaptureImportController");
    expect(editorPage).toContain("useEditorCaptureImport");
    expect(editorPage).toContain("<CaptureImportDialog");
    expect(editorPage).toContain("onImportCaptures={captureImport.open}");
    expect(screensSection).not.toContain('href="/"');
  });

  it("keeps the add-screen action available in every exact-size editing scope", () => {
    expect(screensSection).toContain('ariaLabel="Add screen"');
    expect(screensSection).toContain(
      'className="max-h-64 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"',
    );
    expect(screensSection).not.toContain("Back to primary size");
    expect(screensSection).not.toContain("Primary size");
    expect(screensSection).not.toContain("Return to master");
  });
});
