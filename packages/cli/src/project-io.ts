// SPDX-License-Identifier: Apache-2.0
import { resolve } from "node:path";
import { Project, type Project as ProjectModel } from "@screenshot-studio/core/model";
import {
  readProjectSnapshot,
  withProjectMutation,
  writeProjectAtomic,
  type ProjectLockOptions,
  type ProjectSnapshot,
} from "@screenshot-studio/core/storage";

export const DEFAULT_PROJECT_FILENAME = "app-store-screenshots.json";

export function resolveProjectPath(flags: Record<string, string>): string {
  return resolve(flags.project ?? DEFAULT_PROJECT_FILENAME);
}

export async function loadProjectSnapshot(projectPath: string): Promise<ProjectSnapshot> {
  return readProjectSnapshot(projectPath);
}

export async function loadProjectFile(projectPath: string): Promise<ProjectModel> {
  return (await loadProjectSnapshot(projectPath)).project;
}

export async function writeProjectFile(projectPath: string, project: ProjectModel): Promise<void> {
  // Validate before write so invalid in-memory projects never hit disk (same contract as before).
  const validated = Project.parse(project);
  await writeProjectAtomic(projectPath, validated);
}

export async function updateProjectFile<T>(
  projectPath: string,
  update: (project: ProjectModel) =>
    | { project: ProjectModel; value: T }
    | Promise<{ project: ProjectModel; value: T }>,
  lockOptions: ProjectLockOptions = {},
): Promise<{ project: ProjectModel; revision: string; value: T }> {
  return withProjectMutation(projectPath, async () => {
    const current = await loadProjectSnapshot(projectPath);
    const updated = await update(current.project);
    const persisted = await writeProjectAtomic(projectPath, updated.project);
    return { ...persisted, value: updated.value };
  }, lockOptions);
}
