// SPDX-License-Identifier: Apache-2.0
import {
  applyCaptureImportPlan,
  planCaptureImport,
  type CaptureImportDiscovery,
} from "@screenshot-studio/core/capture-import";
import { Project } from "@screenshot-studio/core/model";
import {
  validateProjectScaffold,
  type ProjectScaffoldInput,
} from "@screenshot-studio/core/scaffold";
import {
  ManagedProjectCreationService,
} from "./managed-project-creation.server.js";
import type { ManagedProjectRecord } from "./managed-project-repository.server.js";

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Capture import was cancelled");
}

export async function createManagedProjectFromCaptureImport(input: {
  scaffoldInput: ProjectScaffoldInput;
  discovery: CaptureImportDiscovery;
  creationService: ManagedProjectCreationService;
  signal?: AbortSignal;
}): Promise<ManagedProjectRecord> {
  throwIfCancelled(input.signal);
  const scaffold = await input.creationService.buildScaffold(input.scaffoldInput);
  throwIfCancelled(input.signal);
  const targetLayout = scaffold.project.layouts[0]!;
  const starterIds = new Set(targetLayout.screens.map(({ id }) => id));
  const plan = planCaptureImport({
    project: scaffold.project,
    layoutId: targetLayout.id,
    destinationKind: "new-project",
    discovery: input.discovery,
  });
  if (!plan.canApply) throw new Error("Capture import preview is invalid and cannot be applied");
  const applied = applyCaptureImportPlan(scaffold.project, plan);
  const importedProject = structuredClone(applied.project);
  importedProject.layouts[0]!.screens = importedProject.layouts[0]!.screens
    .filter(({ id }) => !starterIds.has(id));
  const validated = validateProjectScaffold({
    project: Project.parse(importedProject),
    resources: [
      ...scaffold.resources,
      ...applied.resources.map(({ destinationPath, bytes }) => ({
        path: destinationPath,
        bytes: new Uint8Array(bytes),
      })),
    ],
  });
  throwIfCancelled(input.signal);
  return input.creationService.createFromValidatedScaffold(validated, { signal: input.signal });
}
