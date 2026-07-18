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
  });
});
