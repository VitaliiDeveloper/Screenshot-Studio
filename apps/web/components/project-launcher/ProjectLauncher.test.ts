// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ProjectLauncher.tsx", import.meta.url), "utf8");

describe("ProjectLauncher import integration", () => {
  it("loads the combined project library and opens entries through the active-project switch fence", () => {
    expect(source).toContain("fetchProjectLibrary");
    expect(source).toContain("openProjectLibraryEntry");
    expect(source).toContain("removeRecentProject");
    expect(source).toContain("switchActiveProject(() => openProjectLibraryEntry(entryId))");
    expect(source).toContain("onRetryProjects={loadProjects}");
    expect(source).toContain("onRemoveRecent={removeRecent}");
  });

  it("removes page-level starter examples and keeps capture import behind Import", () => {
    expect(source).not.toContain("LauncherExampleWorkflow");
    expect(source).not.toContain("selectExample");
    expect(source).toContain("captureImport.open");
  });

  it("keeps Projects visible with an active session and routes successful import to Workspace", () => {
    expect(source).not.toContain('router.replace("/home")');
    expect(source).toContain('router.push("/editor")');
    expect(source).toContain("router.refresh()");
  });

  it("aborts only the active browser transfer and preserves typed resource guidance", () => {
    expect(source).toContain("new AbortController()");
    expect(source).toContain("importControllerRef.current?.abort()");
    expect(source).toContain("ProjectImportClientError");
    expect(source).toContain("caught.missingResources");
  });

  it("keeps the dialog mounted through its exit lifecycle and respects reduced motion", () => {
    expect(source).toContain("requestLauncherDialogExit");
    expect(source).toContain("launcherDialogExitDelay");
    expect(source).toContain("prefers-reduced-motion: reduce");
    expect(source).toContain("dialogClosing={dialogClosing}");
    expect(source).toContain("publishingRef.current || importState.status");
    expect(source).toContain('exitActionRef.current === "cancel"');
  });

  it("releases the publication close guard when an import request fails", () => {
    const importRequest = source.indexOf("void importProject");
    const importFailure = source.indexOf("}).catch((caught: unknown) => {", importRequest);
    const failureBranch = source.slice(
      importFailure,
      source.indexOf("}).finally(() => {", importFailure),
    );

    expect(failureBranch).toContain("publishingRef.current = false");
  });

  it("never exposes browser local-path activation", () => {
    expect(source).not.toContain("PROJECT_PATH");
    expect(source).not.toContain('type="text"');
    expect(source).not.toContain("requestedPath");
  });

  it("creates through the active-project switch fence and routes success to Workspace", () => {
    expect(source).toContain("createProject");
    expect(source).toContain("reduceProjectCreationState");
    expect(source).toContain("switchActiveProject(() => createProject");
    expect(source).toContain('router.push("/editor")');
    expect(source).toContain("creationButtonRef.current?.focus()");
  });

  it("keeps successful creation mounted through one exact-identity navigation", () => {
    const creationRequest = source.indexOf("switchActiveProject(() => createProject");
    const creationFailure = source.indexOf("}).catch((caught: unknown) => {", creationRequest);
    const successBranch = source.slice(creationRequest, creationFailure);

    expect(successBranch).toContain(
      'dispatchCreation({ type: "complete", projectId: result.projectId })',
    );
    expect(successBranch).toContain(
      'router.push("/editor")',
    );
    expect(successBranch).toContain("launcherDialogExitDelay(reducedMotion)");
    expect(successBranch).not.toContain("router.refresh()");
  });

  it("opens App Home capture import as a new managed-project flow behind the switch fence", () => {
    expect(source).toContain("useCaptureImportController");
    expect(source).toContain("CaptureImportDialog");
    expect(source).toContain("currentTarget: null");
    expect(source).toContain("activateNewProject: switchActiveProject");
    expect(source).toContain("assertCaptureImportHandoff");
    expect(source).toContain("await fetchActiveProject()");
    expect(source).toContain("assertCaptureImportRecoveryTarget(activeProject)");
    expect(source).toContain("discardActiveProjectPersistence()");
    expect(source).toContain('router.push("/editor")');
    expect(source).toContain("afterImportExitRef.current = captureImport.open");
    expect(source).toContain("onChooseCapture={chooseCaptureImport}");
  });
});
