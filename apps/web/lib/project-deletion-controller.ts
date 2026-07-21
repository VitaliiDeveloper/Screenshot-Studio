// SPDX-License-Identifier: Apache-2.0
import { withDrainedProjectSaves } from "@web/lib/debounced-save.js";
import {
  advanceProjectDeletionAttempt,
  createProjectDeletionCredentials,
  type ProjectDeletionAttempt,
  type ProjectDeletionAttemptResult,
  type ProjectDeletionRequest,
} from "@web/lib/project-delete-client.js";
import { loadProjectHomeData, type ProjectHomeData } from "@web/lib/project-home-client.js";

export interface ProjectDeletionAttemptHolder {
  attempt: ProjectDeletionAttempt | null;
  inFlight: Promise<ProjectDeletionAttemptResult> | null;
}

export interface ProjectHomeDeletionInput {
  current: ProjectHomeData;
  backup: ProjectDeletionRequest["backup"];
  recovering: boolean;
  holder: ProjectDeletionAttemptHolder;
}

export interface ProjectHomeDeletionDependencies {
  withDrainedSaves?: typeof withDrainedProjectSaves;
  loadData?: typeof loadProjectHomeData;
  createCredentials?: typeof createProjectDeletionCredentials;
  advanceAttempt?: typeof advanceProjectDeletionAttempt;
}

export function advanceProjectHomeDeletion(
  input: ProjectHomeDeletionInput,
  dependencies: ProjectHomeDeletionDependencies = {},
): Promise<ProjectDeletionAttemptResult> {
  if (input.holder.inFlight) return input.holder.inFlight;
  const withDrainedSaves = dependencies.withDrainedSaves ?? withDrainedProjectSaves;
  const loadData = dependencies.loadData ?? loadProjectHomeData;
  const createCredentials = dependencies.createCredentials ?? createProjectDeletionCredentials;
  const advanceAttempt = dependencies.advanceAttempt ?? advanceProjectDeletionAttempt;

  const operation = withDrainedSaves(async () => {
    let attempt = input.holder.attempt;
    if (!attempt) {
      if (input.recovering) throw new Error("Reload Project Home before trying again.");
      const refreshed = await loadData();
      if (!refreshed
        || refreshed.selection.projectId !== input.current.selection.projectId
        || !refreshed.selection.capabilities.deleteProjectPermanently) {
        throw new Error("The active managed project changed before permanent deletion.");
      }
      const lifecycleRevision = refreshed.selection.lifecycleRevision;
      if (!Number.isSafeInteger(lifecycleRevision) || (lifecycleRevision ?? 0) <= 0) {
        throw new Error("Permanent deletion is unavailable until Project Home is reloaded.");
      }
      if (refreshed.resources.project.meta.name !== input.current.resources.project.meta.name) {
        throw new Error("The project name changed. Reload Project Home and confirm the current name.");
      }
      const projectRevision = refreshed.resources.revision.slice(1, -1);
      if (input.backup.kind === "archive"
        && input.backup.projectRevision !== projectRevision) {
        throw new Error("The project changed after archive export. Export a current archive before deleting.");
      }
      attempt = {
        request: {
          ...createCredentials(),
          projectId: refreshed.selection.projectId,
          projectRevision,
          lifecycleRevision: lifecycleRevision!,
          confirmation: refreshed.resources.project.meta.name,
          backup: input.backup,
        },
        admitted: false,
      };
      input.holder.attempt = attempt;
    }
    return advanceAttempt(attempt, input.recovering);
  });
  input.holder.inFlight = operation;
  const clearInFlight = () => {
    if (input.holder.inFlight === operation) input.holder.inFlight = null;
  };
  void operation.then(clearInFlight, clearInFlight);
  return operation;
}
