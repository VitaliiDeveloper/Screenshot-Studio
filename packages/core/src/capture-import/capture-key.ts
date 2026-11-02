// SPDX-License-Identifier: Apache-2.0
import { posix } from "node:path";
import { collectImageUrlReferences } from "@screenshot-studio/core/assets";
import { getLayout, slugify, type Project } from "@screenshot-studio/core/model";
import type { CaptureImportIssue, DiscoveredCapture } from "./index.js";

const IMPORT_DIGEST_LENGTH = 12;

/**
 * Persisted refresh identity: add-mode names every capture resource
 * `assets/imports/<captureKey>-<digest12>.png`, and refresh matches references by that name.
 * Changing this derivation or the resource naming breaks refresh for existing projects.
 */
export function captureImportKey(
  capture: Pick<DiscoveredCapture, "platform" | "device" | "locale" | "filename">,
): string {
  const stem = posix.parse(capture.filename).name;
  return slugify(`${capture.platform}-${capture.device}-${capture.locale}-${stem}`);
}

export function captureResourcePath(key: string, captureDigest: string): string {
  return posix.join("assets", "imports", `${key}-${captureDigest.slice(0, IMPORT_DIGEST_LENGTH)}.png`);
}

export function isCaptureResourceOf(assetUrl: string, key: string): boolean {
  const prefix = `assets/imports/${key}-`;
  return assetUrl.startsWith(prefix)
    && new RegExp(`^[0-9a-f]{${IMPORT_DIGEST_LENGTH}}\\.png$`, "u").test(assetUrl.slice(prefix.length));
}

function duplicateKey(path: string, message: string): CaptureImportIssue {
  return { code: "duplicate-capture-key", path, message };
}

/** Every capture after the first one with the same key; the key cannot tell them apart. */
export function repeatedCaptureKeys(captures: readonly DiscoveredCapture[]): CaptureImportIssue[] {
  const firstByKey = new Map<string, string>();
  const issues: CaptureImportIssue[] = [];
  for (const capture of captures) {
    const key = captureImportKey(capture);
    const first = firstByKey.get(key);
    if (first === undefined) firstByKey.set(key, capture.sourcePath);
    else {
      const message = `Captures ${first} and ${capture.sourcePath} share the capture key "${key}"`;
      issues.push(duplicateKey(capture.sourcePath, message));
    }
  }
  return issues;
}

/** Captures whose key the layout already references; adding them would give refresh two owners. */
export function layoutCaptureKeys(
  project: Project,
  layoutId: string,
  captures: readonly DiscoveredCapture[],
): CaptureImportIssue[] {
  const references = collectImageUrlReferences(project, layoutId);
  const layoutName = getLayout(project, layoutId).name;
  return captures.flatMap((capture) => {
    const key = captureImportKey(capture);
    if (!references.some(({ assetUrl }) => isCaptureResourceOf(assetUrl, key))) return [];
    const message = `"${layoutName}" already uses capture "${key}"; refresh it instead of adding it again`;
    return [duplicateKey(capture.sourcePath, message)];
  });
}
