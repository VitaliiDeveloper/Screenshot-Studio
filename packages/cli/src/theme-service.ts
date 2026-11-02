// SPDX-License-Identifier: Apache-2.0
import { dirname } from "node:path";
import {
  applyDesignPack,
  applyTheme,
  findBuiltInDesignPack,
  parseThemeJson,
  type DesignPack,
  type Theme,
} from "@screenshot-studio/core/themes";
import type { Project } from "@screenshot-studio/core/model";
import { loadProjectPack, ProjectPackError } from "@screenshot-studio/core/packs";
import {
  resolveExistingProjectPath,
  type ProjectLockOptions,
} from "@screenshot-studio/core/storage";
import { updateProjectFile, type ProjectUpdatePreconditions } from "./project-io.js";
import { resolveMutationLayout } from "./layout-commands.js";
import {
  createDefinitionStore,
  DEFINITION_ID,
  type DefinitionListing,
  type DefinitionStoreDependencies,
} from "./managed-definition-store.js";

export type ThemeServiceDependencies = DefinitionStoreDependencies;

export class ThemeValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ThemeValidationError";
  }
}

export class ThemeNotFoundError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ThemeNotFoundError";
  }
}

export class ThemeApplyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ThemeApplyError";
  }
}

const projectThemes = createDefinitionStore<Theme>({
  directoryName: "themes",
  noun: "Theme",
  parse: parseThemeJson,
  ValidationError: ThemeValidationError,
  NotFoundError: ThemeNotFoundError,
});

export function themeId(value: unknown): string {
  if (typeof value !== "string" || !DEFINITION_ID.test(value)) {
    throw new ThemeValidationError("Theme id must be a lowercase slug");
  }
  return value;
}

export async function loadTheme(
  projectPath: string,
  rawId: unknown,
  dependencies: ThemeServiceDependencies = {},
): Promise<Theme> {
  const id = themeId(rawId);
  return projectThemes.load(await resolveExistingProjectPath(projectPath), id, dependencies);
}

export async function listThemes(
  projectPath: string,
  dependencies: ThemeServiceDependencies = {},
): Promise<Theme[]> {
  return projectThemes.list(projectPath, dependencies);
}

export async function listThemesWithErrors(
  projectPath: string,
  dependencies: ThemeServiceDependencies = {},
): Promise<DefinitionListing<Theme>> {
  return projectThemes.listWithErrors(projectPath, dependencies);
}

export async function applyThemeFile(
  projectPath: string,
  rawId: unknown,
  lockOptions: ProjectLockOptions = {},
  layoutReference?: string,
  preconditions: ProjectUpdatePreconditions = {},
): Promise<{
  project: Project;
  revision: string;
  theme: Theme;
}> {
  const id = themeId(rawId);
  const canonicalPath = await resolveExistingProjectPath(projectPath);
  const theme = await projectThemes.load(canonicalPath, id);
  const updated = await updateProjectFile(canonicalPath, (current) => {
    try {
      const layout = resolveMutationLayout(current, layoutReference);
      return { project: applyTheme(current, layout.id, theme), value: undefined };
    } catch (error) {
      throw new ThemeApplyError((error as Error).message, { cause: error });
    }
  }, lockOptions, {}, preconditions);
  return { project: updated.project, revision: updated.revision, theme };
}

/** Apply a process-global pack without reading or copying any project resource file. */
export async function applyBuiltInDesignPackFile(
  projectPath: string,
  rawId: unknown,
  lockOptions: ProjectLockOptions = {},
  layoutReference?: string,
  preconditions: ProjectUpdatePreconditions = {},
): Promise<{
  project: Project;
  revision: string;
  pack: DesignPack;
}> {
  const id = themeId(rawId);
  const pack = findBuiltInDesignPack(id);
  if (!pack) throw new ThemeNotFoundError(`Built-in design pack "${id}" not found`);
  const canonicalPath = await resolveExistingProjectPath(projectPath);
  const updated = await updateProjectFile(canonicalPath, (current) => {
    try {
      const layout = resolveMutationLayout(current, layoutReference);
      return { project: applyDesignPack(current, layout.id, pack), value: undefined };
    } catch (error) {
      throw new ThemeApplyError((error as Error).message, { cause: error });
    }
  }, lockOptions, {}, preconditions);
  return { project: updated.project, revision: updated.revision, pack };
}

/** Apply `packs/<id>/design-pack.json` through the same bake as a built-in design pack. */
export async function applyProjectDesignPackFile(
  projectPath: string,
  rawId: unknown,
  lockOptions: ProjectLockOptions = {},
  layoutReference?: string,
  preconditions: ProjectUpdatePreconditions = {},
): Promise<{
  project: Project;
  revision: string;
  pack: DesignPack;
}> {
  const id = themeId(rawId);
  const canonicalPath = await resolveExistingProjectPath(projectPath);
  const updated = await updateProjectFile(canonicalPath, async (current) => {
    let local;
    try {
      local = await loadProjectPack(dirname(canonicalPath), id);
    } catch (error) {
      if (!(error instanceof ProjectPackError)) throw error;
      throw error.notFound
        ? new ThemeNotFoundError(`Project design pack "${id}" not found`, { cause: error })
        : new ThemeValidationError(error.message, { cause: error });
    }
    if (local.kind !== "design") throw new ThemeNotFoundError(`Project design pack "${id}" not found; ${local.manifest} is a screen pack`);
    try {
      const layout = resolveMutationLayout(current, layoutReference);
      return { project: applyDesignPack(current, layout.id, local.pack), value: local.pack };
    } catch (error) {
      throw new ThemeApplyError((error as Error).message, { cause: error });
    }
  }, lockOptions, {}, preconditions);
  return { project: updated.project, revision: updated.revision, pack: updated.value };
}
