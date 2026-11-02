// SPDX-License-Identifier: Apache-2.0
import type { CaptureImportPlan } from "./types.js";

export class CaptureImportConfirmationError extends Error {
  override name = "CaptureImportConfirmationError";

  constructor() {
    super("Capture import preview changed; preview again before applying");
  }
}

export class CaptureImportCancelledError extends Error {
  override name = "CaptureImportCancelledError";

  constructor() {
    super("Capture import was cancelled");
  }
}

export function assertCaptureImportNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CaptureImportCancelledError();
}

export function assertCaptureImportConfirmation(
  plan: Pick<CaptureImportPlan, "confirmationFingerprint">,
  confirmationFingerprint: string | undefined,
): void {
  if (confirmationFingerprint !== plan.confirmationFingerprint) {
    throw new CaptureImportConfirmationError();
  }
}
