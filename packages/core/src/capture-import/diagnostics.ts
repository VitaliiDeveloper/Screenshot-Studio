// SPDX-License-Identifier: Apache-2.0
import type {
  CaptureImportIssue,
  CaptureImportIssueCode,
  CaptureImportWarning,
  CaptureImportWarningCode,
} from "./types.js";

export function issue(code: CaptureImportIssueCode, path: string, message: string): CaptureImportIssue {
  return { code, path, message };
}

export function warning(
  code: CaptureImportWarningCode,
  path: string,
  message: string,
): CaptureImportWarning {
  return { code, path, message };
}
