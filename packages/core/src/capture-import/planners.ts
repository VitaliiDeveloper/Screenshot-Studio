// SPDX-License-Identifier: Apache-2.0
import { posix } from "node:path";
import { collectImageUrlReferences, replaceImageUrls } from "@screenshot-studio/core/assets";
import { outputFamilyLabel, type StoreSpecs } from "@screenshot-studio/core/export";
import {
  addScreenToProject,
  createScreenshotElement,
  getLayout,
  uniqueId,
  type Project as ProjectModel,
} from "@screenshot-studio/core/model";
import {
  captureImportKey,
  captureResourcePath,
  isCaptureResourceOf,
  layoutCaptureKeys,
  repeatedCaptureKeys,
} from "./capture-key.js";
import { warning } from "./diagnostics.js";
import { comparePortable } from "./portable-path.js";
import type {
  CaptureImportIssue,
  CaptureImportPlannedRefresh,
  CaptureImportPlannedResource,
  CaptureImportPlannedScreen,
  CaptureImportWarning,
  DiscoveredCapture,
} from "./types.js";

export interface CaptureImportPlanParts {
  project: ProjectModel;
  screens: CaptureImportPlannedScreen[];
  refreshes: CaptureImportPlannedRefresh[];
  unchanged: string[];
  captureResources: CaptureImportPlannedResource[];
  warnings: CaptureImportWarning[];
  invalidEntries: CaptureImportIssue[];
}

export function planAddedScreens(
  base: ProjectModel,
  layoutId: string,
  captures: readonly DiscoveredCapture[],
  specs: StoreSpecs,
): CaptureImportPlanParts {
  let project = base;
  const screens: CaptureImportPlannedScreen[] = [];
  const captureResources: CaptureImportPlannedResource[] = [];
  const invalidEntries = [...repeatedCaptureKeys(captures), ...layoutCaptureKeys(base, layoutId, captures)];
  const rejected = new Set(invalidEntries.map(({ path }) => path));

  for (const capture of captures) {
    if (rejected.has(capture.sourcePath)) continue;
    const currentLayout = getLayout(project, layoutId);
    const stem = posix.parse(capture.filename).name;
    const captureKey = captureImportKey(capture);
    const screenId = uniqueId(captureKey, currentLayout.screens);
    const elementId = `${screenId}-screenshot`;
    // Named by capture key, not the possibly suffixed screen id, so refresh can find it.
    const resourcePath = captureResourcePath(captureKey, capture.digest);
    const name = `${outputFamilyLabel(capture.platform, capture.device, specs)} · ${capture.locale} · ${stem}`;
    project = addScreenToProject(project, layoutId, {
      ...capture,
      id: screenId,
      name,
      locale: capture.locale,
      artboard: { width: capture.width, height: capture.height },
      elements: [createScreenshotElement({
        id: elementId,
        x: 0,
        y: 0,
        width: capture.width,
        height: capture.height,
        assetUrl: resourcePath,
      })],
    });
    screens.push({
      sourcePath: capture.sourcePath,
      screenId,
      elementId,
      resourcePath,
      platform: capture.platform,
      device: capture.device,
      locale: capture.locale,
      width: capture.width,
      height: capture.height,
    });
    if (!captureResources.some(({ destinationPath }) => destinationPath === resourcePath)) {
      captureResources.push({
        sourcePath: capture.sourcePath,
        destinationPath: resourcePath,
        digest: capture.digest,
        bytes: new Uint8Array(capture.bytes),
      });
    }
  }
  return { project, screens, refreshes: [], unchanged: [], captureResources, warnings: [], invalidEntries };
}

export function planRefreshedReferences(
  base: ProjectModel,
  layoutId: string,
  captures: readonly DiscoveredCapture[],
): CaptureImportPlanParts {
  const references = collectImageUrlReferences(base, layoutId);
  const layoutName = getLayout(base, layoutId).name;
  const replacements = new Map<string, string>();
  const refreshes: CaptureImportPlannedRefresh[] = [];
  const unchanged: string[] = [];
  const captureResources: CaptureImportPlannedResource[] = [];
  const warnings: CaptureImportWarning[] = [];
  const invalidEntries = repeatedCaptureKeys(captures);
  const rejected = new Set(invalidEntries.map(({ path }) => path));

  for (const capture of captures) {
    if (rejected.has(capture.sourcePath)) continue;
    const captureKey = captureImportKey(capture);
    const matches = references.filter(({ assetUrl }) => isCaptureResourceOf(assetUrl, captureKey));
    if (matches.length === 0) {
      warnings.push(warning(
        "unmatched-capture",
        capture.sourcePath,
        `No screen in "${layoutName}" uses capture "${captureKey}"; import without --refresh to add it`,
      ));
      continue;
    }
    const resourcePath = captureResourcePath(captureKey, capture.digest);
    const previousPaths = [...new Set(matches.map(({ assetUrl }) => assetUrl))]
      .filter((path) => path !== resourcePath)
      .sort(comparePortable);
    if (previousPaths.length === 0) {
      unchanged.push(capture.sourcePath);
      continue;
    }
    for (const path of previousPaths) replacements.set(path, resourcePath);
    refreshes.push({
      sourcePath: capture.sourcePath,
      captureKey,
      resourcePath,
      previousPaths,
      references: matches
        .filter(({ assetUrl }) => assetUrl !== resourcePath)
        .map(({ screenId, elementId }) => ({ screenId, elementId })),
    });
    captureResources.push({
      sourcePath: capture.sourcePath,
      destinationPath: resourcePath,
      digest: capture.digest,
      bytes: new Uint8Array(capture.bytes),
    });
  }
  const project = invalidEntries.length > 0 || replacements.size === 0
    ? base
    : replaceImageUrls(base, layoutId, replacements);
  return { project, screens: [], refreshes, unchanged, captureResources, warnings, invalidEntries };
}
