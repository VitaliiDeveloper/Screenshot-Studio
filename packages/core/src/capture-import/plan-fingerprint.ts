// SPDX-License-Identifier: Apache-2.0
import { Project, type Project as ProjectModel } from "@screenshot-studio/core/model";
import { digest, jsonDigest } from "./digest.js";
import { jsonIgnoringGeneratedIds } from "./generated-ids.js";
import type { CaptureImportPlan } from "./types.js";

export function baseProjectFingerprint(project: ProjectModel): string {
  return jsonDigest(Project.parse(project));
}

// The planned project embeds the base, so the raw base digest (which changes with a starter
// scaffold's fresh ids) stays out; applyCaptureImportPlan still checks it exactly.
export function planFingerprint(plan: Omit<CaptureImportPlan, "confirmationFingerprint">): string {
  const { baseProjectFingerprint: _base, ...confirmed } = plan;
  return digest(new TextEncoder().encode(jsonIgnoringGeneratedIds({
    ...confirmed,
    project: Project.parse(plan.project),
    resources: plan.resources.map(({ bytes, ...resource }) => ({
      ...resource,
      bytesDigest: digest(bytes),
    })),
  })));
}
