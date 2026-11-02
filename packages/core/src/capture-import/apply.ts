// SPDX-License-Identifier: Apache-2.0
import { Project, type Project as ProjectModel } from "@screenshot-studio/core/model";
import { baseProjectFingerprint, planFingerprint } from "./plan-fingerprint.js";
import type { CaptureImportPlan, CaptureImportPlannedResource } from "./types.js";

export function applyCaptureImportPlan(
  project: ProjectModel,
  plan: CaptureImportPlan,
): { project: ProjectModel; resources: CaptureImportPlannedResource[] } {
  if (baseProjectFingerprint(project) !== plan.baseProjectFingerprint) {
    throw new Error("Capture import target Project changed after preview");
  }
  const { confirmationFingerprint, ...planWithoutFingerprint } = plan;
  if (planFingerprint(planWithoutFingerprint) !== confirmationFingerprint) {
    throw new Error("Capture import preview changed after planning");
  }
  if (!plan.canApply || plan.invalidEntries.length > 0) {
    throw new Error("Capture import preview contains invalid entries");
  }
  return {
    project: Project.parse(structuredClone(plan.project)),
    resources: plan.resources.map((resource) => ({
      ...resource,
      bytes: new Uint8Array(resource.bytes),
    })),
  };
}
