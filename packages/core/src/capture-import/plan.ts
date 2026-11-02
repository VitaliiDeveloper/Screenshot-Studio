// SPDX-License-Identifier: Apache-2.0
import { DEFAULT_STORE_SPECS, type StoreSpecs } from "@screenshot-studio/core/export";
import { Project, getLayout, type Project as ProjectModel } from "@screenshot-studio/core/model";
import { issue } from "./diagnostics.js";
import { baseProjectFingerprint, planFingerprint } from "./plan-fingerprint.js";
import { planAddedScreens, planRefreshedReferences } from "./planners.js";
import { comparePortable, portablePathKey } from "./portable-path.js";
import type {
  CaptureImportDestinationKind,
  CaptureImportDiscovery,
  CaptureImportIssue,
  CaptureImportMode,
  CaptureImportPlan,
  CaptureImportPlannedResource,
} from "./types.js";

export function planCaptureImport(input: {
  project: ProjectModel;
  layoutId: string;
  destinationKind: CaptureImportDestinationKind;
  discovery: CaptureImportDiscovery;
  mode?: CaptureImportMode;
  specs?: StoreSpecs;
}): CaptureImportPlan {
  const specs = input.specs ?? DEFAULT_STORE_SPECS;
  const mode = input.mode ?? "add";
  const base = Project.parse(structuredClone(input.project));
  const layout = getLayout(base, input.layoutId);
  const parts = mode === "refresh"
    ? planRefreshedReferences(base, input.layoutId, input.discovery.captures)
    : planAddedScreens(base, input.layoutId, input.discovery.captures, specs);
  const { screens, refreshes, unchanged, captureResources } = parts;
  let project = parts.project;

  project = Project.parse(project);
  // A project-root input also lists the project's earlier import resources as related assets.
  const plannedCaptureBytes = new Set(captureResources.map(({ destinationPath, digest: revision }) =>
    `${portablePathKey(destinationPath)}\0${revision}`));
  const resources = [
    ...captureResources,
    ...input.discovery.assets
      .filter((asset) => !plannedCaptureBytes.has(`${portablePathKey(asset.destinationPath)}\0${asset.digest}`))
      .map((asset) => ({
        sourcePath: asset.sourcePath,
        destinationPath: asset.destinationPath,
        digest: asset.digest,
        bytes: new Uint8Array(asset.bytes),
      })),
  ];
  const invalidEntries = [...structuredClone(input.discovery.invalidEntries), ...parts.invalidEntries];
  const destinations = new Map<string, CaptureImportPlannedResource>();
  for (const resource of resources) {
    const destinationKey = portablePathKey(resource.destinationPath);
    const existing = destinations.get(destinationKey);
    if (existing) {
      invalidEntries.push(issue(
        "destination-conflict",
        resource.destinationPath,
        `Multiple inputs plan the same resource path: ${existing.sourcePath} and ${resource.sourcePath}`,
      ));
    } else {
      destinations.set(destinationKey, resource);
    }
  }
  invalidEntries.sort((left, right) => comparePortable(left.path, right.path));
  const projectFingerprint = baseProjectFingerprint(base);
  const planWithoutFingerprint = {
    receiving: {
      kind: input.destinationKind,
      projectName: base.meta.name,
      layoutId: layout.id,
      layoutName: layout.name,
    },
    mode,
    summary: structuredClone(input.discovery.summary),
    screens,
    refreshes,
    unchanged,
    resources,
    warnings: [...structuredClone(input.discovery.warnings), ...parts.warnings]
      .sort((left, right) => comparePortable(left.path, right.path)),
    invalidEntries,
    project,
    canApply: (mode === "refresh" ? refreshes.length : screens.length) > 0 && invalidEntries.length === 0,
    baseProjectFingerprint: projectFingerprint,
  };
  return {
    ...planWithoutFingerprint,
    confirmationFingerprint: planFingerprint(planWithoutFingerprint),
  };
}

export function withCaptureImportInvalidEntries(
  plan: CaptureImportPlan,
  entries: readonly CaptureImportIssue[],
): CaptureImportPlan {
  if (entries.length === 0) return plan;
  const { confirmationFingerprint: _confirmationFingerprint, ...withoutFingerprint } = plan;
  const next = {
    ...withoutFingerprint,
    invalidEntries: [...withoutFingerprint.invalidEntries, ...structuredClone(entries)]
      .sort((left, right) => comparePortable(left.path, right.path)),
    canApply: false,
  };
  return { ...next, confirmationFingerprint: planFingerprint(next) };
}
