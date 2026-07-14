// SPDX-License-Identifier: Apache-2.0
import { dirname, resolve } from "node:path";
import { Project, type Project as ProjectModel } from "@screenshot-studio/core/model";
import { LocalFileStorageAdapter } from "@screenshot-studio/core/storage";

export const DEFAULT_PROJECT_FILENAME = "app-store-screenshots.json";

export function resolveProjectPath(flags: Record<string, string>): string {
  return resolve(flags.project ?? DEFAULT_PROJECT_FILENAME);
}

function adapterFor(projectPath: string): LocalFileStorageAdapter {
  // assetsDir is unused by load/save; keep it next to the project file for putAsset callers.
  return new LocalFileStorageAdapter(dirname(projectPath));
}

export async function loadProjectFile(projectPath: string): Promise<ProjectModel> {
  return adapterFor(projectPath).load(projectPath);
}

export async function writeProjectFile(projectPath: string, project: ProjectModel): Promise<void> {
  // Validate before write so invalid in-memory projects never hit disk (same contract as before).
  const validated = Project.parse(project);
  await adapterFor(projectPath).save(validated, projectPath);
}
