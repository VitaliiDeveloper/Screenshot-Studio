// SPDX-License-Identifier: Apache-2.0
import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { Project, type Project as ProjectModel } from "@screenshot-studio/core/model";
import {
  createProjectAtomic,
  ProjectPathError,
  readIdentifiedProjectSnapshot,
  readProjectSnapshot,
  resolveExistingProjectPath,
  withProjectMutation,
  writeProjectConditionalAtomic,
  type ProjectFileDependencies,
  type ProjectLockOptions,
  type ProjectSnapshot,
} from "@screenshot-studio/core/storage";

export const DEFAULT_PROJECT_FILENAME = "app-store-screenshots.json";

export interface ProjectUpdateTransaction {
  onRollback(action: () => void | Promise<void>): void;
  onCommit(action: () => void | Promise<void>): void;
}

export function resolveProjectPath(flags: Record<string, string>): string {
  return resolve(flags.project ?? DEFAULT_PROJECT_FILENAME);
}

export async function loadProjectSnapshot(projectPath: string): Promise<ProjectSnapshot> {
  return readProjectSnapshot(await resolveExistingProjectPath(projectPath));
}

export async function loadProjectFile(projectPath: string): Promise<ProjectModel> {
  return (await loadProjectSnapshot(projectPath)).project;
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type ProjectWriteTarget =
  | { kind: "existing"; path: string }
  | { kind: "missing"; path: string };

async function resolveProjectWriteTarget(projectPath: string): Promise<ProjectWriteTarget> {
  try {
    return { kind: "existing", path: await resolveExistingProjectPath(projectPath) };
  } catch (error) {
    if (!(error instanceof ProjectPathError) || errorCode(error.cause) !== "ENOENT") throw error;
    const absolutePath = resolve(projectPath);
    try {
      await lstat(absolutePath);
    } catch (entryError) {
      if (errorCode(entryError) === "ENOENT") return { kind: "missing", path: absolutePath };
      throw entryError;
    }
    // A dangling symlink still occupies the requested path and must not be replaced.
    throw error;
  }
}

export async function writeProjectFile(
  projectPath: string,
  project: ProjectModel,
  fileDependencies: ProjectFileDependencies = {},
): Promise<void> {
  // Validate before write so invalid in-memory projects never hit disk (same contract as before).
  const validated = Project.parse(project);
  const target = await resolveProjectWriteTarget(projectPath);
  if (target.kind === "missing") {
    await createProjectAtomic(target.path, validated, fileDependencies);
    return;
  }

  const observed = await readIdentifiedProjectSnapshot(target.path, fileDependencies);
  await writeProjectConditionalAtomic(target.path, validated, observed, fileDependencies);
}

export async function updateProjectFile<T>(
  projectPath: string,
  update: (project: ProjectModel, transaction: ProjectUpdateTransaction) =>
    | { project: ProjectModel; value: T }
    | Promise<{ project: ProjectModel; value: T }>,
  lockOptions: ProjectLockOptions = {},
  fileDependencies: ProjectFileDependencies = {},
): Promise<{ project: ProjectModel; revision: string; value: T }> {
  const canonicalPath = await resolveExistingProjectPath(projectPath);
  return withProjectMutation(canonicalPath, async () => {
    const current = await readIdentifiedProjectSnapshot(canonicalPath, fileDependencies);
    const rollbackActions: Array<() => void | Promise<void>> = [];
    const commitActions: Array<() => void | Promise<void>> = [];
    const transaction: ProjectUpdateTransaction = {
      onRollback(action) {
        rollbackActions.push(action);
      },
      onCommit(action) {
        commitActions.push(action);
      },
    };

    let result: { project: ProjectModel; revision: string; value: T };
    try {
      const updated = await update(current.project, transaction);
      // Returning the exact object read under this lease is the explicit signal to preserve the
      // persisted bytes and revision without invoking the atomic writer.
      if (updated.project === current.project) {
        result = {
          project: current.project,
          revision: current.revision,
          value: updated.value,
        };
      } else {
        const persisted = await writeProjectConditionalAtomic(
          canonicalPath,
          updated.project,
          current,
          fileDependencies,
        );
        result = { ...persisted, value: updated.value };
      }
    } catch (primaryError) {
      const rollbackErrors: unknown[] = [];
      for (let index = rollbackActions.length - 1; index >= 0; index -= 1) {
        try {
          await rollbackActions[index]!();
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length > 0) {
        const primaryMessage = primaryError instanceof Error
          ? primaryError.message
          : String(primaryError);
        throw new AggregateError(
          [primaryError, ...rollbackErrors],
          `${primaryMessage}; project update rollback failed: ${rollbackErrors.map(errorText).join("; ")}`,
          { cause: primaryError },
        );
      }
      throw primaryError;
    }

    const commitErrors: unknown[] = [];
    for (const action of commitActions) {
      try {
        await action();
      } catch (commitError) {
        commitErrors.push(commitError);
      }
    }
    if (commitErrors.length > 0) {
      throw new AggregateError(
        commitErrors,
        `Project update committed but cleanup failed: ${commitErrors.map(errorText).join("; ")}`,
        { cause: commitErrors[0] },
      );
    }
    return result;
  }, lockOptions);
}
