// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import {
  createScreenFromTemplate,
  createScreensFromTemplatePack,
  findBuiltInTemplate,
  findBuiltInTemplatePack,
  listBuiltInTemplatePackMetadata,
  listBuiltInTemplatePacks,
  listBuiltInTemplates as listCoreBuiltInTemplates,
  parseTemplateJson,
  type ScreenTemplate,
  type TemplatePack,
} from "@screenshot-studio/core/templates";
import {
  listProjectPacks,
  loadProjectPack,
  MAX_PACK_ASSET_BYTES,
  packAssetUrls,
  DESIGN_PACK_MANIFEST,
  PACKS_DIRECTORY,
  ProjectPackError,
  readContainedFile,
  readProjectPackAsset,
  SCREEN_PACK_MANIFEST,
  templatePackFromLayout,
  withPackAssetUrls,
  type ProjectPackListing,
} from "@screenshot-studio/core/packs";
import { archivableResourceStem, getLayout, type Project, type Screen } from "@screenshot-studio/core/model";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import {
  resolveExistingProjectPath,
  withProjectMutation,
  type ProjectLockOptions,
} from "@screenshot-studio/core/storage";
import { publishManagedResourceFile, removeManagedResourceFile } from "./managed-resource-file.js";
import { publishFileSafely } from "./safe-file-publisher.js";
import { assertProjectImageBytes, ProjectImageValidationError, safeStem } from "./project-image-service.js";
import {
  loadProjectFile,
  updateProjectFile,
  type ProjectUpdatePreconditions,
  type ProjectUpdateTransaction,
} from "./project-io.js";
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
    const template = findBuiltInTemplate(id, specs, current.fonts[0])
      ?? listBuiltInTemplatePacks(specs).filter((pack) => !pack.panorama)
        .flatMap((pack) => pack.screens).find((screen) => screen.id === id);
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

async function appendTemplatePackScreens(
  canonicalPath: string,
  resolvePack: (transaction: ProjectUpdateTransaction) => Promise<TemplatePack>,
  locale: string,
  specs: StoreSpecs,
  lockOptions: ProjectLockOptions,
  layoutReference: string | undefined,
  preconditions: ProjectUpdatePreconditions,
): Promise<{ project: Project; revision: string; screens: Screen[] }> {
  const updated = await updateProjectFile(canonicalPath, async (current, transaction) => {
    const pack = await resolvePack(transaction);
    try {
      const layout = resolveMutationLayout(current, layoutReference);
      const result = createScreensFromTemplatePack(current, layout.id, pack, locale, specs);
      return { project: result.project, value: result.screens };
    } catch (error) {
      throw new TemplateCreateError((error as Error).message, { cause: error });
    }
  }, lockOptions, {}, preconditions);
  return { project: updated.project, revision: updated.revision, screens: updated.value };
}

/** Append every screen of a process-global screen pack in one locked project update. */
export async function createBuiltInTemplatePackScreens(
  projectPath: string,
  rawId: unknown,
  rawLocale: unknown,
  specs: StoreSpecs,
  lockOptions: ProjectLockOptions = {},
  layoutReference?: string,
  preconditions: ProjectUpdatePreconditions = {},
): Promise<{ project: Project; revision: string; screens: Screen[] }> {
  const id = templateId(rawId);
  const locale = templateLocale(rawLocale);
  const pack = findBuiltInTemplatePack(id, specs);
  if (!pack) throw new TemplateNotFoundError(`Built-in template pack "${id}" not found`);
  const canonicalPath = await resolveExistingProjectPath(projectPath);
  return appendTemplatePackScreens(canonicalPath, async () => pack, locale, specs, lockOptions, layoutReference, preconditions);
}

export async function loadProjectPackListing(projectPath: string): Promise<ProjectPackListing> {
  return listProjectPacks(dirname(await resolveExistingProjectPath(projectPath)));
}

function projectPackError(error: unknown, id: string): Error {
  if (!(error instanceof ProjectPackError)) return error as Error;
  return error.notFound
    ? new TemplateNotFoundError(`Template pack "${id}" not found: no built-in pack and no ${PACKS_DIRECTORY}/${id}`, { cause: error })
    : new TemplateValidationError(error.message, { cause: error });
}

/**
 * Applied pack assets become ordinary project assets, named like an upload: a sanitized stem and the
 * extension of the decoded format. The digest keeps an edited pack from colliding with bytes an
 * earlier apply published.
 */
export function projectPackAssetPath(packId: string, assetUrl: string, bytes: Uint8Array, extension: string): string {
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const stem = archivableResourceStem(safeStem(assetUrl).slice(0, 80), "asset");
  return `assets/packs/${packId}/${digest}-${stem}${extension}`;
}

/**
 * Append every screen of `packs/<id>/screen-pack.json`. Under the same lease, each pack asset is
 * published as an ordinary project asset and the pack is rewritten to point at it, so the
 * document stays strict and portable; published files are removed if the update rolls back.
 */
export async function createProjectTemplatePackScreens(
  projectPath: string,
  rawId: unknown,
  rawLocale: unknown,
  specs: StoreSpecs,
  lockOptions: ProjectLockOptions = {},
  layoutReference?: string,
  preconditions: ProjectUpdatePreconditions = {},
): Promise<{ project: Project; revision: string; screens: Screen[] }> {
  const id = templateId(rawId);
  const locale = templateLocale(rawLocale);
  const canonicalPath = await resolveExistingProjectPath(projectPath);
  const root = dirname(canonicalPath);
  return appendTemplatePackScreens(canonicalPath, async (transaction) => {
    try {
      const local = await loadProjectPack(root, id);
      if (local.kind !== "screen") throw new TemplateNotFoundError(`Project screen pack "${id}" not found; ${local.manifest} is a design pack`);
      const replacements = new Map<string, string>();
      for (const url of packAssetUrls(local.pack)) {
        const bytes = await readProjectPackAsset(root, id, url);
        let extension: string;
        try {
          extension = await assertProjectImageBytes(bytes);
        } catch (error) {
          if (!(error instanceof ProjectImageValidationError)) throw error;
          throw new TemplateValidationError(`${local.manifest}: ${PACKS_DIRECTORY}/${id}/${url}: ${error.message}`, { cause: error });
        }
        const relativePath = projectPackAssetPath(id, url, bytes, extension);
        const publication = await publishManagedResourceFile({ root, relativePath, bytes });
        if (publication.created) transaction.onRollback(() => removeManagedResourceFile(root, relativePath, publication.ownership).then(() => {}));
        replacements.set(url, relativePath);
      }
      return withPackAssetUrls(local.pack, replacements);
    } catch (error) {
      throw projectPackError(error, id);
    }
  }, locale, specs, lockOptions, layoutReference, preconditions);
}

async function canonicalOutPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(await canonicalOutPath(parent), basename(path));
  }
}

/**
 * Write one layout as `packs/<id>/screen-pack.json` plus a copy of every asset it references at the
 * same relative path. A relative `out` resolves against the project folder and must be exactly
 * `packs/<id>`, so the result is discoverable. With `force`, an existing screen pack's files are
 * overwritten one by one; files the new pack does not write are left in place.
 */
export async function exportLayoutPack(
  projectPath: string,
  out: string,
  options: { layout?: string; locale?: string; force?: boolean } = {},
  lockOptions: ProjectLockOptions = {},
): Promise<{ dir: string; pack: TemplatePack; assets: string[]; skipped: string[] }> {
  const canonicalPath = await resolveExistingProjectPath(projectPath);
  const root = dirname(canonicalPath);
  const invalid = (error: unknown) => error instanceof ProjectPackError
    ? new TemplateValidationError(error.message, { cause: error })
    : error;
  return withProjectMutation(canonicalPath, async () => {
    const outPath = isAbsolute(out) ? out : join(root, out);
    const existing = await lstat(outPath).catch(() => undefined);
    if (existing?.isSymbolicLink()) throw new TemplateValidationError(`--out must not be a symbolic link: ${out}`);
    const segments = relative(root, await canonicalOutPath(outPath)).split(sep);
    const id = segments[1] ?? "";
    if (segments.length !== 2 || segments[0] !== PACKS_DIRECTORY || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      throw new TemplateValidationError(`--out must be ${PACKS_DIRECTORY}/<lowercase-slug> inside the project folder ${root}: ${out}`);
    }
    const dir = `${PACKS_DIRECTORY}/${id}`;
    if (listBuiltInTemplatePackMetadata().some((pack) => pack.id === id)) {
      throw new TemplateValidationError(`${dir}: "${id}" is already a built-in pack id; choose another name`);
    }
    if (existing) {
      if (!options.force) throw new TemplateValidationError(`${dir} already exists; pass --force to replace it`);
      if (await lstat(join(outPath, DESIGN_PACK_MANIFEST)).then(() => true, () => false)) {
        throw new TemplateValidationError(`${dir} holds a design pack; --force replaces only a screen pack`);
      }
    }
    const project = await loadProjectFile(canonicalPath);
    const layout = resolveMutationLayout(project, options.layout);
    let exported;
    try {
      exported = templatePackFromLayout(project, layout.id, id, options.locale);
    } catch (error) {
      throw new TemplateValidationError((error as Error).message, { cause: error });
    }
    const files: [string, Uint8Array][] = [
      [SCREEN_PACK_MANIFEST, new TextEncoder().encode(`${JSON.stringify(exported.pack, null, 2)}\n`)],
    ];
    for (const asset of exported.assets) {
      try {
        files.push([asset, await readContainedFile(root, asset, asset, { maxBytes: MAX_PACK_ASSET_BYTES })]);
      } catch (error) {
        throw invalid(error);
      }
    }
    for (const [relativePath, bytes] of files) {
      await publishFileSafely({ root, relativePath: `${dir}/${relativePath}`, bytes, replace: options.force === true });
    }
    // The written folder must load exactly as the picker and `template add --pack` will read it.
    await loadProjectPack(root, id).catch((error) => { throw invalid(error); });
    return { dir, pack: exported.pack, assets: exported.assets, skipped: exported.skipped };
  }, lockOptions);
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
