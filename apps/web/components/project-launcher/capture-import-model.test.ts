// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  canApplyCaptureImport,
  canPreviewCaptureImport,
  createCaptureImportState,
  reduceCaptureImportState,
  type CaptureImportAction,
  type CaptureImportCurrentTarget,
  type CaptureImportState,
} from "./capture-import-model.js";

const currentTarget: CaptureImportCurrentTarget = {
  projectId: "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  revision: `"${"1".repeat(64)}"`,
  projectName: "Current",
  preferredLayoutId: "primary",
  layouts: [
    { id: "primary", name: "Primary" },
    { id: "secondary", name: "Secondary" },
  ],
};
const file = {} as File;
const preview = {
  receiving: { kind: "current-project" as const, projectName: "Current", layoutId: "primary", layoutName: "Primary" },
  summary: { screenCount: 1, assetCount: 0, platforms: [], devices: [], locales: [] },
  screens: [], resources: [], warnings: [], invalidEntries: [], canApply: true,
  confirmationFingerprint: "2".repeat(64),
};

describe("capture import model", () => {
  it("opens without silently choosing a destination", () => {
    const state = createCaptureImportState(currentTarget);

    expect(state).toMatchObject({
      status: "editing",
      draft: {
        files: [],
        destinationKind: null,
        currentLayoutId: "primary",
        newProject: { platform: "apple", device: "iphone", layoutMode: "isolated", templateId: null },
      },
    });
    expect(canPreviewCaptureImport(state)).toBe(false);
  });

  it("updates only the validated scaffold seed when the capture-import destination changes", () => {
    let state: CaptureImportState = createCaptureImportState(null);
    state = reduceCaptureImportState(state, {
      type: "change-new-project", patch: { platform: "android" },
    });
    expect(state).toMatchObject({
      draft: { newProject: { platform: "android", device: "phone" } },
    });

    state = reduceCaptureImportState(state, {
      type: "change-new-project",
      patch: { platform: "android", device: "wear" },
    } as CaptureImportAction);
    expect(state).toMatchObject({
      draft: { newProject: { platform: "android", device: "phone" } },
    });
  });

  it("requires files and an explicit valid current or new destination before preview", () => {
    let state: CaptureImportState = createCaptureImportState(currentTarget);
    state = reduceCaptureImportState(state, { type: "choose-files", files: [file] });
    expect(canPreviewCaptureImport(state)).toBe(false);
    state = reduceCaptureImportState(state, { type: "choose-destination", kind: "current-project" });
    expect(canPreviewCaptureImport(state)).toBe(true);
    state = reduceCaptureImportState(state, { type: "choose-destination", kind: "new-project" });
    state = reduceCaptureImportState(state, { type: "change-new-project", patch: { name: "" } });
    expect(canPreviewCaptureImport(state)).toBe(false);
    state = reduceCaptureImportState(state, {
      type: "change-new-project", patch: { name: "Captured launch" },
    });
    expect(canPreviewCaptureImport(state)).toBe(true);
  });

  it("keeps the server preview immutable through confirmation and disables invalid apply", () => {
    let state: CaptureImportState = createCaptureImportState(currentTarget);
    state = reduceCaptureImportState(state, { type: "choose-files", files: [file] });
    state = reduceCaptureImportState(state, { type: "choose-destination", kind: "current-project" });
    state = reduceCaptureImportState(state, { type: "request-preview" });
    state = reduceCaptureImportState(state, { type: "preview-succeeded", preview });

    expect(state.status).toBe("reviewing");
    if (state.status !== "reviewing") throw new Error("Expected capture import review state");
    expect(canApplyCaptureImport(state)).toBe(true);
    expect(reduceCaptureImportState(state, { type: "apply" })).toMatchObject({
      status: "applying", preview,
    });
    expect(reduceCaptureImportState(
      reduceCaptureImportState(state, { type: "apply" }),
      { type: "complete" },
    )).toEqual({ status: "closed" });
    expect(canApplyCaptureImport({
      ...state,
      preview: { ...preview, canApply: false },
    })).toBe(false);
  });

  it("keeps preview cancellation editable but requires reconciliation after apply cancellation", () => {
    let state: CaptureImportState = createCaptureImportState(currentTarget);
    state = reduceCaptureImportState(state, { type: "choose-files", files: [file] });
    state = reduceCaptureImportState(state, { type: "choose-destination", kind: "current-project" });
    state = reduceCaptureImportState(state, { type: "request-preview" });
    state = reduceCaptureImportState(state, { type: "cancelled", phase: "preview" });
    expect(state).toMatchObject({ status: "editing", notice: "Capture import preview cancelled" });
    state = reduceCaptureImportState(state, { type: "request-preview" });
    state = reduceCaptureImportState(state, { type: "preview-succeeded", preview });
    state = reduceCaptureImportState(state, { type: "apply" });
    state = reduceCaptureImportState(state, { type: "cancelled", phase: "apply" });
    expect(state).toMatchObject({
      status: "error",
      staleTarget: true,
      message: expect.stringContaining("final server result is unknown"),
    });
    expect(reduceCaptureImportState(state, { type: "retry" })).toBe(state);
  });

  it("marks stale failures for recovery", () => {
    let state: CaptureImportState = createCaptureImportState(currentTarget);
    state = reduceCaptureImportState(state, { type: "choose-files", files: [file] });
    state = reduceCaptureImportState(state, { type: "choose-destination", kind: "current-project" });
    state = reduceCaptureImportState(state, { type: "request-preview" });
    state = reduceCaptureImportState(state, {
      type: "failed", message: "Active project changed", staleTarget: true,
    });
    expect(state).toMatchObject({
      status: "error", message: "Active project changed", staleTarget: true,
    });
    state = reduceCaptureImportState(state, { type: "request-recovery" });
    expect(state).toMatchObject({ status: "error", staleTarget: true, recovering: true });
    state = reduceCaptureImportState(state, {
      type: "recovery-failed", message: "Active project could not be reloaded",
    });
    expect(state).toMatchObject({
      status: "error",
      message: "Active project could not be reloaded",
      staleTarget: true,
      recovering: false,
    });
    state = reduceCaptureImportState(state, { type: "request-recovery" });
    expect(reduceCaptureImportState(state, { type: "recovery-succeeded" }))
      .toEqual({ status: "closed" });
  });

  it("cannot dismiss or reopen over a reconciliation-required failure", () => {
    let state: CaptureImportState = createCaptureImportState(currentTarget);
    state = reduceCaptureImportState(state, { type: "choose-files", files: [file] });
    state = reduceCaptureImportState(state, { type: "choose-destination", kind: "current-project" });
    state = reduceCaptureImportState(state, { type: "request-preview" });
    state = reduceCaptureImportState(state, {
      type: "failed", message: "Apply result is unknown", staleTarget: true,
    });

    expect(reduceCaptureImportState(state, { type: "close" })).toBe(state);
    expect(reduceCaptureImportState(state, { type: "open", currentTarget })).toBe(state);
  });

  it("does not offer current-project destination when App Home has no current target", () => {
    let state: CaptureImportState = createCaptureImportState(null);
    state = reduceCaptureImportState(state, { type: "choose-files", files: [file] });
    state = reduceCaptureImportState(state, { type: "choose-destination", kind: "current-project" });

    if (state.status !== "editing") throw new Error("Expected capture import editing state");
    expect(state.draft.destinationKind).toBeNull();
    expect(canPreviewCaptureImport(state)).toBe(false);
  });
});
