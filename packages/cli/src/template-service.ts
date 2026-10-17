// SPDX-License-Identifier: Apache-2.0
import {
  createScreenFromTemplate,
  findBuiltInTemplate,
  listBuiltInTemplates as listCoreBuiltInTemplates,
  parseTemplateJson,
  type ScreenTemplate,
} from "@screenshot-studio/core/templates";
import { getLayout, type Project, type Screen } from "@screenshot-studio/core/model";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import {
  resolveExistingProjectPath,
  type ProjectLockOptions,
} from "@screenshot-studio/core/storage";
import { loadProjectFile, updateProjectFile, type ProjectUpdatePreconditions } from "./project-io.js";
import { resolveMutationLayout } from "./layout-commands.js";
import {
  createDefinitionStore,
  DEFINITION_ID,
  type DefinitionStoreDependencies,
} from "./managed-definition-store.js";

export type TemplateServiceDependencies = DefinitionStoreDependencies;

export class TemplateValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TemplateValidationError";
  }
}

export class TemplateNotFoundError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TemplateNotFoundError";
  }
}

export class TemplateCreateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TemplateCreateError";
  }
}

const projectTemplates = createDefinitionStore<ScreenTemplate>({
  directoryName: "templates",
  noun: "Template",
  parse: parseTemplateJson,
  ValidationError: TemplateValidationError,
  NotFoundError: TemplateNotFoundError,
});

export function templateId(value: unknown): string {
  if (typeof value !== "string" || !DEFINITION_ID.test(value)) {
    throw new TemplateValidationError("Template id must be a lowercase slug");
  }
  return value;
}

export function templateLocale(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TemplateValidationError("Template locale must be a non-empty string");
  }
  return value;
}

export async function loadTemplate(
  projectPath: string,
  rawId: unknown,
  dependencies: TemplateServiceDependencies = {},
): Promise<ScreenTemplate> {
  const id = templateId(rawId);
  return projectTemplates.load(await resolveExistingProjectPath(projectPath), id, dependencies);
}

export async function listTemplates(
  projectPath: string,
  dependencies: TemplateServiceDependencies = {},
): Promise<ScreenTemplate[]> {
  return projectTemplates.list(projectPath, dependencies);
}

export async function listBuiltInTemplates(projectPath: string, specs: StoreSpecs): Promise<ScreenTemplate[]> {
  const project = await loadProjectFile(await resolveExistingProjectPath(projectPath));
  return listCoreBuiltInTemplates(specs, project.fonts[0]);
}

export async function createBuiltInTemplateScreen(
  projectPath: string,
  rawId: unknown,
  rawLocale: unknown,
  specs: StoreSpecs,
  lockOptions: ProjectLockOptions = {},
  layoutReference?: string,
  preconditions: ProjectUpdatePreconditions = {},
): Promise<{ project: Project; revision: string; screen: Screen; template: ScreenTemplate }> {
  const id = templateId(rawId);
  const locale = templateLocale(rawLocale);
  const canonicalPath = await resolveExistingProjectPath(projectPath);
  const updated = await updateProjectFile(canonicalPath, (current) => {
    const template = findBuiltInTemplate(id, specs, current.fonts[0]);
    if (!template) throw new TemplateNotFoundError(`Built-in template "${id}" not found`);
    try {
      const layout = resolveMutationLayout(current, layoutReference);
      const result = createScreenFromTemplate(current, layout.id, template, locale, specs);
      return { project: result.project, value: { layoutId: layout.id, screenId: result.screen.id, template } };
    } catch (error) {
      throw new TemplateCreateError((error as Error).message, { cause: error });
    }
  }, lockOptions, {}, preconditions);
  const screen = getLayout(updated.project, updated.value.layoutId).screens
    .find((candidate) => candidate.id === updated.value.screenId)!;
  return { project: updated.project, revision: updated.revision, screen, template: updated.value.template };
}

export async function createTemplateScreen(
  projectPath: string,
  rawId: unknown,
  rawLocale: unknown,
  lockOptions: ProjectLockOptions = {},
  layoutReference?: string,
  preconditions: ProjectUpdatePreconditions = {},
  specs?: StoreSpecs,
): Promise<{ project: Project; revision: string; screen: Screen; template: ScreenTemplate }> {
  const id = templateId(rawId);
  const canonicalPath = await resolveExistingProjectPath(projectPath);
  const template = await projectTemplates.load(canonicalPath, id);
  const locale = templateLocale(rawLocale);
  const updated = await updateProjectFile(canonicalPath, (current) => {
    try {
      const layout = resolveMutationLayout(current, layoutReference);
      const result = createScreenFromTemplate(current, layout.id, template, locale, specs);
      return { project: result.project, value: { layoutId: layout.id, screenId: result.screen.id } };
    } catch (error) {
      throw new TemplateCreateError((error as Error).message, { cause: error });
    }
  }, lockOptions, {}, preconditions);
  const screen = getLayout(updated.project, updated.value.layoutId).screens
    .find((candidate) => candidate.id === updated.value.screenId)!;
  return { project: updated.project, revision: updated.revision, screen, template };
}
