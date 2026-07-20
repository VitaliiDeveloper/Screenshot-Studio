// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CaptureImportClientError } from "../../lib/capture-import-client.js";
import {
  assertCaptureImportHandoff,
  assertCaptureImportRecoveryTarget,
  captureImportApplyFailureAction,
  CaptureImportHandoffError,
  completeCaptureImportHandoff,
  isStaleCaptureImportError,
  resolveCaptureImportRecovery,
} from "./useCaptureImportController.js";

const source = readFileSync(new URL("./useCaptureImportController.ts", import.meta.url), "utf8");

describe("useCaptureImportController", () => {
  it("classifies stale confirmation, project, and revision failures for recovery", () => {
    expect(isStaleCaptureImportError(new CaptureImportClientError("changed", "preview-changed", 409))).toBe(true);
    expect(isStaleCaptureImportError(new CaptureImportClientError("stale", "request-failed", 412))).toBe(true);
    expect(isStaleCaptureImportError(new CaptureImportClientError("invalid", "invalid-preview", 422))).toBe(false);
    expect(isStaleCaptureImportError(new CaptureImportHandoffError())).toBe(true);
  });

  it("rejects a handoff when another tab changes the active receiving project", () => {
    const result = {
      projectId: "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      project: {
        sessionId: "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        name: "Receiver",
        sourceKind: "managed-project",
        capabilities: {
          writeInPlace: true,
          revealLocation: false,
          watchExternalChanges: false,
          nativePicker: false,
          projectLocalResources: true,
          exportProjectArchive: true,
        deleteProjectPermanently: true,
        },
      },
      imported: 1,
    };

    expect(() => assertCaptureImportHandoff(
      result,
      "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    )).not.toThrow();
    expect(() => assertCaptureImportHandoff(
      result,
      "project_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    )).toThrow(CaptureImportHandoffError);
  });

  it("requires reconciliation when post-commit completion fails or is cancelled", async () => {
    const result = {
      projectId: "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      project: {
        sessionId: "session-a",
        name: "Receiver",
        sourceKind: "managed-project",
        capabilities: {
          writeInPlace: true,
          revealLocation: false,
          watchExternalChanges: false,
          nativePicker: false,
          projectLocalResources: true,
          exportProjectArchive: true,
        deleteProjectPermanently: true,
        },
      },
      imported: 1,
    };
    const controller = new AbortController();
    const completion = vi.fn(async () => { throw new Error("Project Home load failed"); });

    await expect(completeCaptureImportHandoff(
      result,
      "current-project",
      controller.signal,
      completion,
    )).rejects.toBeInstanceOf(CaptureImportHandoffError);
    expect(completion).toHaveBeenCalledOnce();

    controller.abort();
    const cancelledCompletion = vi.fn();
    await expect(completeCaptureImportHandoff(
      result,
      "current-project",
      controller.signal,
      cancelledCompletion,
    )).rejects.toBeInstanceOf(CaptureImportHandoffError);
    expect(cancelledCompletion).not.toHaveBeenCalled();
  });

  it("turns a failed active-project reload into an explicit recovery action", async () => {
    await expect(resolveCaptureImportRecovery(async () => {
      throw new Error("Active project could not be reloaded");
    })).resolves.toEqual({
      type: "recovery-failed",
      message: "Active project could not be reloaded",
    });
    await expect(resolveCaptureImportRecovery(async () => undefined))
      .resolves.toEqual({ type: "recovery-succeeded" });
  });

  it("does not call recovery successful without a proven active project", () => {
    expect(() => assertCaptureImportRecoveryTarget(null)).toThrow(CaptureImportHandoffError);
    expect(() => assertCaptureImportRecoveryTarget({
      projectId: "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    })).not.toThrow();
  });

  it("requires reconciliation for an indeterminate apply transport failure", () => {
    expect(captureImportApplyFailureAction(new TypeError("fetch failed"))).toEqual({
      type: "failed",
      message: "fetch failed",
      staleTarget: true,
    });
    expect(captureImportApplyFailureAction(
      new CaptureImportClientError("invalid after confirmation", "invalid-response", 200),
    )).toMatchObject({ type: "failed", staleTarget: true });
  });

  it("cancels the one active request and keeps new-project activation distinct from current apply", () => {
    expect(source).toContain("controllerRef.current?.abort()");
    expect(source).toContain('destinationKind === "new-project"');
    expect(source).toContain("activateNewProject(operation)");
    expect(source).toContain(": operation()");
    expect(source).toContain('phase: "preview"');
    expect(source).toContain('phase: "apply"');
  });

  it("closes only after the executable post-commit handoff succeeds", () => {
    const completion = source.indexOf("await completeCaptureImportHandoff(");
    const close = source.indexOf('dispatch({ type: "complete" })', completion);
    const applyCall = source.indexOf("applyCaptureImport(");

    expect(applyCall).toBeGreaterThan(0);
    expect(completion).toBeGreaterThan(applyCall);
    expect(close).toBeGreaterThan(completion);
  });
});
