// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

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

  it("blocks Project Home navigation on a save failure and exposes an alert", () => {
    expect(source).toContain("navigateToProjectHome");
    expect(source).toContain("setNavigationError");
    expect(source).toContain('role="alert"');
    expect(source).toContain("onOpenProjectHome");
  });

  it("keeps a beforeunload safeguard while writes are pending or failed", () => {
    expect(source).toContain('window.addEventListener("beforeunload"');
    expect(source).toContain("hasPendingProjectSave()");
    expect(source).toContain('saveStatus !== "saving" && saveStatus !== "error"');
  });
});
