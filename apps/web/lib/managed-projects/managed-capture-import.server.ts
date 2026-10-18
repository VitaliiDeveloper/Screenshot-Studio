// SPDX-License-Identifier: Apache-2.0
import {
  applyCaptureImportPlan,
  assertCaptureImportConfirmation,
  assertCaptureImportNotCancelled,
  planCaptureImport,
  type CaptureImportDiscovery,
  type CaptureImportPlan,
} from "@screenshot-studio/core/capture-import";
import { Project } from "@screenshot-studio/core/model";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import {
  validateProjectScaffold,
  type ProjectScaffoldInput,
} from "@screenshot-studio/core/scaffold";
import {
  ManagedProjectCreationService,
} from "./managed-project-creation.server.js";
import type { ManagedProjectRecord } from "./managed-project-repository.server.js";

export async function createManagedProjectFromCaptureImport(input: {
  scaffoldInput: ProjectScaffoldInput;
  discovery: CaptureImportDiscovery;
  confirmationFingerprint?: string;
  creationService: ManagedProjectCreationService;
  specs: StoreSpecs;
  signal?: AbortSignal;
}): Promise<ManagedProjectRecord> {
  assertCaptureImportNotCancelled(input.signal);
  const scaffold = await input.creationService.buildScaffold(input.scaffoldInput, input.specs);
  assertCaptureImportNotCancelled(input.signal);
  const targetLayout = scaffold.project.layouts[0]!;
  const starterIds = new Set(targetLayout.screens.map(({ id }) => id));
  const plan = planCaptureImport({
    project: scaffold.project,
    layoutId: targetLayout.id,
    destinationKind: "new-project",
    discovery: input.discovery,
    specs: input.specs,
  });
  if (input.confirmationFingerprint !== undefined) {
    assertCaptureImportConfirmation(plan, input.confirmationFingerprint);
  }
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
  assertCaptureImportNotCancelled(input.signal);
  return input.creationService.createFromValidatedScaffold(validated, { signal: input.signal });
}

export async function previewManagedProjectCaptureImport(input: {
  scaffoldInput: ProjectScaffoldInput;
  discovery: CaptureImportDiscovery;
  creationService: ManagedProjectCreationService;
  specs: StoreSpecs;
  signal?: AbortSignal;
}): Promise<CaptureImportPlan> {
  assertCaptureImportNotCancelled(input.signal);
  const scaffold = await input.creationService.buildScaffold(input.scaffoldInput, input.specs);
  assertCaptureImportNotCancelled(input.signal);
  const targetLayout = scaffold.project.layouts[0]!;
  return planCaptureImport({
    project: scaffold.project,
    layoutId: targetLayout.id,
    destinationKind: "new-project",
    discovery: input.discovery,
    specs: input.specs,
  });
}
