// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const projectNavigation = readFileSync(
  new URL("./use-editor-project-navigation.ts", import.meta.url),
  "utf8",
);
const saveGuards = readFileSync(
  new URL("./use-editor-save-guards.ts", import.meta.url),
  "utf8",
);

describe("Workspace round-trip navigation", () => {
  it("restores project-keyed view state and applies existing-surface action intents", () => {
    expect(source).toContain("readWorkspaceNavigationState");
    expect(source).toContain("writeWorkspaceNavigationState");
    expect(source).toContain('intent === "locales"');
    expect(source).toContain('intent === "export"');
    expect(source).toContain('intent === "add-screen"');
    expect(source).toContain("setTimeout(() => {");
    expect(source).toContain("writeWorkspaceNavigationState(activeProjectId, workspaceNavigationState)");
  });

  it("opens Projects from the bottom rail and blocks navigation on a save failure", () => {
    expect(projectNavigation).toContain("navigateToProjects");
    expect(projectNavigation).toContain("setError");
    expect(source).toContain('role="alert"');
    expect(source).toContain("onOpenProjects={projectNavigation.openProjects}");
    expect(projectNavigation).toContain('router.push("/")');
    expect(source).not.toContain("nextjs-portal");
  });

  it("keeps a beforeunload safeguard while writes are pending or failed", () => {
    expect(source).toContain("useEditorSaveGuards(saveStatus)");
    expect(saveGuards).toContain('window.addEventListener("beforeunload"');
    expect(saveGuards).toContain("hasPendingProjectSave()");
    expect(saveGuards).toContain('saveStatus !== "saving" && saveStatus !== "error"');
  });
});
