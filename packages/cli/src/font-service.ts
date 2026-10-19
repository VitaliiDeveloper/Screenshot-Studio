// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import { dirname, extname } from "node:path";
import {
  countProjectFontUsage,
  DEFAULT_FONT_WEIGHT,
  FONT_WEIGHT_MAX,
  FONT_WEIGHT_MIN,
  isProjectRelativePath,
  slugify,
  type FontAsset,
  type Project as ProjectModel,
} from "@screenshot-studio/core/model";
import {
  errorCode,
  resolveExistingProjectPath,
  type ProjectFileDependencies,
  type ProjectLockOptions,
} from "@screenshot-studio/core/storage";
import {
  FontValidationError,
  parseSupportedFont,
} from "./font-validation.js";
import {
  loadProjectFile,
  updateProjectFile,
  type ProjectUpdatePreconditions,
} from "./project-io.js";
import {
  ManagedResourceConflictError,
  publishManagedResourceFile,
  quarantineManagedResourceFile,
  removeManagedResourceFile,
  type ManagedResourceFilePublication,
  type ManagedResourceOwnership,
  type ManagedResourcePublication,
  type ManagedResourceQuarantine,
} from "./managed-resource-file.js";

export { FontValidationError } from "./font-validation.js";

const SUPPORTED_EXTENSIONS = new Set([".ttf", ".otf", ".woff", ".woff2"]);
const GOOGLE_CSS_ENDPOINT = "https://fonts.googleapis.com/css2";
const GOOGLE_FONT_HOST = "fonts.gstatic.com";
const FONT_INGEST_USER_AGENT = "ScreenshotStudio-FontIngest/1.0";
const MANAGED_FONT_PREFIX = "assets/fonts/";

export class FontConflictError extends Error {
  override name = "FontConflictError";
}

export class FontNotFoundError extends Error {
  override name = "FontNotFoundError";
}

export class GoogleFontError extends Error {
  override name = "GoogleFontError";
}

export class FontInUseError extends Error {
  override name = "FontInUseError";

  constructor(
    readonly family: string,
    readonly weight: number,
    readonly usage: number,
  ) {
    super(
      `Font "${family}" ${weight} is used by ${usage} text ${usage === 1 ? "element" : "elements"} and cannot be removed`,
    );
  }
}

type PublishFontFile = (
  options: ManagedResourceFilePublication,
) => Promise<ManagedResourcePublication>;
type RemoveFontFile = (
  root: string,
  relativePath: string,
  expectedOwnership?: ManagedResourceOwnership,
) => Promise<boolean>;
type QuarantineFontFile = (
  root: string,
  relativePath: string,
) => Promise<ManagedResourceQuarantine | null>;

export interface FontServiceDependencies {
  fetch?: typeof fetch;
  publishFontFile?: PublishFontFile;
  removeFontFile?: RemoveFontFile;
  quarantineFontFile?: QuarantineFontFile;
  lockOptions?: ProjectLockOptions;
  fileDependencies?: ProjectFileDependencies;
}

export interface FontMutationResult {
  project: ProjectModel;
  revision: string;
}

export interface AddFontInput {
  family: string;
  weight: number;
}

export interface AddUploadedFontInput extends AddFontInput {
  filename: string;
  bytes: Uint8Array;
}

export async function loadFontProject(projectPath: string): Promise<ProjectModel> {
  return loadProjectFile(projectPath);
}

export function fontWeight(value: unknown): number {
  const weight = Number(value ?? DEFAULT_FONT_WEIGHT);
  if (!Number.isInteger(weight) || weight < FONT_WEIGHT_MIN || weight > FONT_WEIGHT_MAX) {
    throw new FontValidationError(`weight must be an integer from ${FONT_WEIGHT_MIN} through ${FONT_WEIGHT_MAX}`);
  }
  return weight;
}

export function fontFamily(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new FontValidationError("family must be a non-empty string");
  }
  return value.trim();
}

export function findFont(project: ProjectModel, family: string, weight: number): FontAsset | undefined {
  return project.fonts.find((font) => font.family === family && font.weight === weight);
}

function extensionOrThrow(path: string): string {
  const extension = extname(path).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new FontValidationError(`Unsupported font file "${path}". Expected .ttf, .otf, .woff, or .woff2`);
  }
  return extension;
}

function targetAssetPath(family: string, weight: number, extension: string): string {
  return `assets/fonts/${slugify(family)}-${weight}${extension}`;
}

function googleCssUrl(family: string, weight: number): string {
  const params = new URLSearchParams({ family: `${family}:wght@${weight}` });
  return `${GOOGLE_CSS_ENDPOINT}?${params}`;
}

function extractSingleFontUrl(css: string): string {
  const urls = [...new Set(
    [...css.matchAll(/src:\s*url\(([^)]+)\)/g)]
      .map((match) => match[1]!.trim().replace(/^['"]|['"]$/g, "")),
  )];
  if (urls.length !== 1) {
    throw new GoogleFontError(`Google Fonts returned ${urls.length} font files; expected exactly one full-coverage font file`);
  }
  return urls[0]!;
}

export async function downloadGoogleFont(
  family: string,
  weight: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: Buffer; extension: string }> {
  try {
    const cssResponse = await fetchImpl(googleCssUrl(family, weight), {
      headers: { "user-agent": FONT_INGEST_USER_AGENT },
    });
    if (!cssResponse.ok) throw new GoogleFontError(`Google Fonts CSS request failed: HTTP ${cssResponse.status}`);
    const fontUrl = extractSingleFontUrl(await cssResponse.text());
    const parsedFontUrl = new URL(fontUrl);
    if (parsedFontUrl.protocol !== "https:" || parsedFontUrl.hostname !== GOOGLE_FONT_HOST) {
      throw new GoogleFontError(`Google Fonts returned a disallowed font URL: ${fontUrl}`);
    }
    let extension: string;
    try {
      extension = extensionOrThrow(parsedFontUrl.pathname);
    } catch (error) {
      throw new GoogleFontError((error as Error).message);
    }
    const fontResponse = await fetchImpl(parsedFontUrl.href);
    if (!fontResponse.ok) throw new GoogleFontError(`Google Fonts download failed: HTTP ${fontResponse.status}`);
    return { bytes: Buffer.from(await fontResponse.arrayBuffer()), extension };
  } catch (error) {
    if (error instanceof GoogleFontError) throw error;
    throw new GoogleFontError(`Google Fonts request failed: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

function isManagedFontPath(path: string): boolean {
  return isProjectRelativePath(path)
    && path.startsWith(MANAGED_FONT_PREFIX)
    && path.length > MANAGED_FONT_PREFIX.length;
}

async function addMaterializedFontMutation(
  projectPath: string,
  input: AddFontInput & { source: FontAsset["source"]; extension: string; bytes: Uint8Array },
  dependencies: FontServiceDependencies = {},
  preconditions: ProjectUpdatePreconditions = {},
): Promise<FontMutationResult> {
  const family = fontFamily(input.family);
  const weight = fontWeight(input.weight);
  const canonicalProjectPath = await resolveExistingProjectPath(projectPath);
  const root = dirname(canonicalProjectPath);
  const path = targetAssetPath(family, weight, input.extension);
  const publishFontFile = dependencies.publishFontFile ?? publishManagedResourceFile;
  const removeFontFile = dependencies.removeFontFile ?? removeManagedResourceFile;

  const updated = await updateProjectFile(canonicalProjectPath, async (project, transaction) => {
    if (findFont(project, family, weight)) {
      throw new FontConflictError(`Font "${family}" ${weight} is already registered`);
    }

    let publication: ManagedResourcePublication;
    try {
      publication = await publishFontFile({ root, relativePath: path, bytes: input.bytes });
    } catch (error) {
      if (error instanceof ManagedResourceConflictError) {
        throw new FontConflictError(`Refusing to overwrite existing font file: ${error.path}`);
      }
      throw error;
    }
    if (publication.created) {
      transaction.onRollback(async () => {
        await removeFontFile(root, path, publication.ownership);
      });
    }

    const nextProject: ProjectModel = {
      ...project,
      fonts: [...project.fonts, { family, source: input.source, path, weight }],
    };
    return { project: nextProject, value: undefined };
  }, dependencies.lockOptions, dependencies.fileDependencies, preconditions);

  return { project: updated.project, revision: updated.revision };
}

export async function addUploadedFontMutation(
  projectPath: string,
  input: AddUploadedFontInput,
  dependencies: FontServiceDependencies = {},
  preconditions: ProjectUpdatePreconditions = {},
): Promise<FontMutationResult> {
  const family = fontFamily(input.family);
  const weight = fontWeight(input.weight);
  const parsed = parseSupportedFont(input.bytes, input.filename);
  return addMaterializedFontMutation(projectPath, {
    family,
    weight,
    source: "uploaded",
    extension: `.${parsed.format}`,
    bytes: input.bytes,
  }, dependencies, preconditions);
}

export async function addUploadedFont(
  projectPath: string,
  input: AddUploadedFontInput,
  dependencies: FontServiceDependencies = {},
): Promise<ProjectModel> {
  return (await addUploadedFontMutation(projectPath, input, dependencies)).project;
}

export async function addUploadedFontFile(
  projectPath: string,
  input: AddFontInput & { file: string },
  dependencies: FontServiceDependencies = {},
): Promise<ProjectModel> {
  extensionOrThrow(input.file);
  let bytes: Buffer;
  try {
    bytes = await readFile(input.file);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      throw new FontNotFoundError(`Font file not found: ${input.file}`);
    }
    throw error;
  }
  return addUploadedFont(projectPath, {
    family: input.family,
    weight: input.weight,
    filename: input.file,
    bytes,
  }, dependencies);
}

export async function addGoogleFontMutation(
  projectPath: string,
  input: AddFontInput,
  dependencies: FontServiceDependencies = {},
  preconditions: ProjectUpdatePreconditions = {},
): Promise<FontMutationResult> {
  const family = fontFamily(input.family);
  const weight = fontWeight(input.weight);
  const project = await loadProjectFile(projectPath);
  if (findFont(project, family, weight)) {
    throw new FontConflictError(`Font "${family}" ${weight} is already registered`);
  }
  const downloaded = await downloadGoogleFont(family, weight, dependencies.fetch);
  try {
    parseSupportedFont(downloaded.bytes, `google-font${downloaded.extension}`);
  } catch (error) {
    if (error instanceof FontValidationError) {
      throw new GoogleFontError(error.message, { cause: error });
    }
    throw error;
  }
  return addMaterializedFontMutation(projectPath, {
    family,
    weight,
    source: "google",
    extension: downloaded.extension,
    bytes: downloaded.bytes,
  }, dependencies, preconditions);
}

export async function addGoogleFont(
  projectPath: string,
  input: AddFontInput,
  dependencies: FontServiceDependencies = {},
): Promise<ProjectModel> {
  return (await addGoogleFontMutation(projectPath, input, dependencies)).project;
}

export async function removeFontMutation(
  projectPath: string,
  input: AddFontInput,
  dependencies: FontServiceDependencies = {},
  preconditions: ProjectUpdatePreconditions = {},
): Promise<FontMutationResult> {
  const family = fontFamily(input.family);
  const weight = fontWeight(input.weight);
  const canonicalProjectPath = await resolveExistingProjectPath(projectPath);
  const root = dirname(canonicalProjectPath);
  const quarantineFontFile = dependencies.quarantineFontFile ?? quarantineManagedResourceFile;

  const updated = await updateProjectFile(canonicalProjectPath, async (project, transaction) => {
    const font = findFont(project, family, weight);
    if (!font) throw new FontNotFoundError(`Font "${family}" ${weight} is not registered`);

    const usage = countProjectFontUsage(project, { family, weight });
    if (usage > 0) throw new FontInUseError(family, weight, usage);

    const nextProject: ProjectModel = {
      ...project,
      fonts: project.fonts.filter((entry) => entry !== font),
    };
    const isShared = nextProject.fonts.some((entry) => entry.path === font.path);
    if (isManagedFontPath(font.path) && !isShared) {
      const quarantine = await quarantineFontFile(root, font.path);
      if (quarantine) {
        transaction.onRollback(() => quarantine.restore());
        transaction.onCommit(() => quarantine.discard());
      }
    }
    return { project: nextProject, value: undefined };
  }, dependencies.lockOptions, dependencies.fileDependencies, preconditions);

  return { project: updated.project, revision: updated.revision };
}

export async function removeFont(
  projectPath: string,
  input: AddFontInput,
  dependencies: FontServiceDependencies = {},
): Promise<ProjectModel> {
  return (await removeFontMutation(projectPath, input, dependencies)).project;
}
