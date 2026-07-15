// SPDX-License-Identifier: Apache-2.0
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import {
  createScreenFromTemplate,
  parseTemplateJson,
  type ScreenTemplate,
} from "@screenshot-studio/core/templates";
import type { Project, Screen } from "@screenshot-studio/core/model";
import {
  resolveExistingProjectPath,
  type ProjectLockOptions,
} from "@screenshot-studio/core/storage";
import { updateProjectFile } from "./project-io.js";

const TEMPLATE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface TemplateDefinitionHandle {
  stat: (options: { bigint: true }) => Promise<BigIntStats>;
  readFile: () => Promise<Buffer>;
  close: () => Promise<void>;
}

export interface TemplateServiceDependencies {
  openDefinition?: (path: string, flags: number) => Promise<TemplateDefinitionHandle>;
  lstatDefinitionPath?: (
    path: string,
    options: { bigint: true },
  ) => Promise<BigIntStats>;
  realpathDefinitionPath?: (path: string) => Promise<string>;
}

interface TemplateDirectoryBoundary {
  path: string;
  canonicalPath: string;
  device: bigint;
  inode: bigint;
}

interface MissingPathResult {
  kind: "missing";
  error: NodeJS.ErrnoException;
}

interface TemplateDefinitionRead {
  json: string;
  path: string;
}

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

export function templateId(value: unknown): string {
  if (typeof value !== "string" || !TEMPLATE_ID.test(value)) {
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

function templatesDir(projectPath: string): string {
  return join(dirname(projectPath), "templates");
}

function isMissingPath(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function missingPathResult(error: unknown): MissingPathResult {
  return { kind: "missing", error: error as NodeJS.ErrnoException };
}

function isMissingResult(
  value: TemplateDirectoryBoundary | TemplateDefinitionRead | MissingPathResult | BigIntStats,
): value is MissingPathResult {
  return "kind" in value && value.kind === "missing";
}

function hasCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === code;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withCloseError(primary: unknown, cleanup: unknown): AggregateError {
  return new AggregateError(
    [primary, cleanup],
    `${errorMessage(primary)}; template definition close failed: ${errorMessage(cleanup)}`,
    { cause: primary },
  );
}

function noFollowReadFlags(): number {
  return constants.O_RDONLY
    | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0)
    | (typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0);
}

function assertTemplatePathContained(
  projectPath: string,
  canonicalResourcePath: string,
  label: string,
): void {
  const projectRoot = dirname(projectPath);
  const fromRoot = relative(projectRoot, canonicalResourcePath);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new TemplateValidationError(
      `${label} must stay inside canonical project root ${projectRoot}`,
    );
  }
}

async function validateTemplatesDirectory(
  projectPath: string,
  dependencies: TemplateServiceDependencies = {},
): Promise<TemplateDirectoryBoundary | MissingPathResult> {
  const dir = templatesDir(projectPath);
  let stats;
  try {
    stats = await (dependencies.lstatDefinitionPath ?? lstat)(dir, { bigint: true });
  } catch (error) {
    if (isMissingPath(error)) return missingPathResult(error);
    throw error;
  }
  if (stats.isSymbolicLink()) {
    throw new TemplateValidationError(
      `Template definitions directory must not be a symbolic link: ${dir}`,
    );
  }
  if (!stats.isDirectory()) {
    throw new TemplateValidationError(`Template definitions path must be a directory: ${dir}`);
  }
  let canonicalPath: string;
  try {
    canonicalPath = await (dependencies.realpathDefinitionPath ?? realpath)(dir);
  } catch (error) {
    if (isMissingPath(error)) return missingPathResult(error);
    throw error;
  }
  assertTemplatePathContained(projectPath, canonicalPath, "Template definitions directory");
  return {
    path: dir,
    canonicalPath,
    device: stats.dev,
    inode: stats.ino,
  };
}

async function revalidateTemplatesDirectory(
  projectPath: string,
  expected: TemplateDirectoryBoundary,
  dependencies: TemplateServiceDependencies = {},
): Promise<void> {
  const current = await validateTemplatesDirectory(projectPath, dependencies);
  if (isMissingResult(current)) {
    throw new TemplateValidationError(
      `Template definitions directory disappeared: ${expected.path}`,
      { cause: current.error },
    );
  }
  if (
    current.device !== expected.device
    || current.inode !== expected.inode
    || current.canonicalPath !== expected.canonicalPath
  ) {
    throw new TemplateValidationError(
      `Template definitions directory changed while reading: ${expected.path}`,
    );
  }
}

async function inspectTemplateDefinitionLeaf(
  projectPath: string,
  path: string,
  dependencies: TemplateServiceDependencies,
): Promise<BigIntStats | MissingPathResult> {
  let stats: BigIntStats;
  try {
    stats = await (dependencies.lstatDefinitionPath ?? lstat)(path, { bigint: true });
  } catch (error) {
    if (isMissingPath(error)) return missingPathResult(error);
    throw error;
  }
  if (stats.isSymbolicLink()) {
    throw new TemplateValidationError(`Template definition must not be a symbolic link: ${path}`);
  }
  if (!stats.isFile()) {
    throw new TemplateValidationError(`Template definition must be a regular file: ${path}`);
  }
  let canonicalPath: string;
  try {
    canonicalPath = await (dependencies.realpathDefinitionPath ?? realpath)(path);
  } catch (error) {
    if (isMissingPath(error)) return missingPathResult(error);
    throw error;
  }
  assertTemplatePathContained(projectPath, canonicalPath, "Template definition");
  return stats;
}

async function revalidateTemplateDefinitionLeaf(
  projectPath: string,
  path: string,
  expected: BigIntStats,
  dependencies: TemplateServiceDependencies,
): Promise<void> {
  const current = await inspectTemplateDefinitionLeaf(projectPath, path, dependencies);
  if (isMissingResult(current)) {
    throw new TemplateValidationError(`Template definition disappeared while reading: ${path}`, {
      cause: current.error,
    });
  }
  if (current.dev !== expected.dev || current.ino !== expected.ino) {
    throw new TemplateValidationError(`Template definition changed while reading: ${path}`);
  }
}

async function readCanonicalTemplateDefinition(
  projectPath: string,
  filename: string,
  dependencies: TemplateServiceDependencies = {},
  expectedDirectory?: TemplateDirectoryBoundary,
): Promise<TemplateDefinitionRead | MissingPathResult> {
  let directory: TemplateDirectoryBoundary;
  if (expectedDirectory) {
    await revalidateTemplatesDirectory(projectPath, expectedDirectory, dependencies);
    directory = expectedDirectory;
  } else {
    const inspectedDirectory = await validateTemplatesDirectory(projectPath, dependencies);
    if (isMissingResult(inspectedDirectory)) return inspectedDirectory;
    directory = inspectedDirectory;
  }
  const path = join(directory.path, filename);
  const inspectedLeaf = await inspectTemplateDefinitionLeaf(projectPath, path, dependencies);
  if (isMissingResult(inspectedLeaf)) return inspectedLeaf;
  await revalidateTemplatesDirectory(projectPath, directory, dependencies);

  const openDefinition = dependencies.openDefinition
    ?? (async (definitionPath: string, flags: number) => open(definitionPath, flags));
  let handle: TemplateDefinitionHandle;
  try {
    handle = await openDefinition(path, noFollowReadFlags());
  } catch (error) {
    if (hasCode(error, "ELOOP")) {
      throw new TemplateValidationError(
        `Template definition must not be a symbolic link: ${path}`,
        { cause: error },
      );
    }
    if (isMissingPath(error)) return missingPathResult(error);
    throw error;
  }

  let result: TemplateDefinitionRead | undefined;
  let primaryError: unknown;
  let hasPrimaryError = false;
  try {
    await revalidateTemplatesDirectory(projectPath, directory, dependencies);
    const openedStats = await handle.stat({ bigint: true });
    if (!openedStats.isFile()) {
      throw new TemplateValidationError(`Template definition must be a regular file: ${path}`);
    }
    if (openedStats.dev !== inspectedLeaf.dev || openedStats.ino !== inspectedLeaf.ino) {
      throw new TemplateValidationError(`Template definition changed while it was opened: ${path}`);
    }
    await revalidateTemplateDefinitionLeaf(projectPath, path, inspectedLeaf, dependencies);
    await revalidateTemplatesDirectory(projectPath, directory, dependencies);
    const bytes = await handle.readFile();
    await revalidateTemplateDefinitionLeaf(projectPath, path, inspectedLeaf, dependencies);
    await revalidateTemplatesDirectory(projectPath, directory, dependencies);
    result = { json: bytes.toString("utf8"), path };
  } catch (error) {
    primaryError = error;
    hasPrimaryError = true;
  }

  try {
    await handle.close();
  } catch (closeError) {
    primaryError = hasPrimaryError
      ? withCloseError(primaryError, closeError)
      : closeError;
    hasPrimaryError = true;
  }

  if (hasPrimaryError) throw primaryError;
  return result!;
}

function parseDefinition(json: string, path: string): ScreenTemplate {
  try {
    return parseTemplateJson(json);
  } catch (error) {
    throw new TemplateValidationError(`Invalid template at ${path}: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

async function loadCanonicalTemplate(
  projectPath: string,
  id: string,
  dependencies: TemplateServiceDependencies = {},
): Promise<ScreenTemplate> {
  const path = join(templatesDir(projectPath), `${id}.json`);
  const definition = await readCanonicalTemplateDefinition(
    projectPath,
    `${id}.json`,
    dependencies,
  );
  if (isMissingResult(definition)) {
    throw new TemplateNotFoundError(`Template "${id}" not found at ${path}`, {
      cause: definition.error,
    });
  }
  const template = parseDefinition(definition.json, definition.path);
  if (template.id !== id) {
    throw new TemplateValidationError(
      `Template file id "${template.id}" does not match requested id "${id}"`,
    );
  }
  return template;
}

export async function loadTemplate(
  projectPath: string,
  rawId: unknown,
  dependencies: TemplateServiceDependencies = {},
): Promise<ScreenTemplate> {
  const id = templateId(rawId);
  return loadCanonicalTemplate(await resolveExistingProjectPath(projectPath), id, dependencies);
}

export async function listTemplates(
  projectPath: string,
  dependencies: TemplateServiceDependencies = {},
): Promise<ScreenTemplate[]> {
  const canonicalProjectPath = await resolveExistingProjectPath(projectPath);
  const directory = await validateTemplatesDirectory(canonicalProjectPath, dependencies);
  if (isMissingResult(directory)) return [];
  let entries;
  try {
    entries = await readdir(directory.path, { withFileTypes: true });
  } catch (error) {
    if (isMissingPath(error)) return [];
    throw error;
  }
  await revalidateTemplatesDirectory(canonicalProjectPath, directory, dependencies);
  const definitionEntries = entries.filter((entry) => entry.name.endsWith(".json"));
  const linkedEntry = definitionEntries.find((entry) => entry.isSymbolicLink());
  if (linkedEntry) {
    throw new TemplateValidationError(
      `Template definition must not be a symbolic link: ${join(directory.path, linkedEntry.name)}`,
    );
  }
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  const templates = await Promise.all(files.map(async (file) => {
    const definition = await readCanonicalTemplateDefinition(
      canonicalProjectPath,
      file,
      dependencies,
      directory,
    );
    if (isMissingResult(definition)) {
      throw new TemplateValidationError(
        `Template definition disappeared while listing: ${join(directory.path, file)}`,
        { cause: definition.error },
      );
    }
    const template = parseDefinition(definition.json, definition.path);
    if (`${template.id}.json` !== file) {
      throw new TemplateValidationError(`Template file ${file} must match its id "${template.id}"`);
    }
    return template;
  }));
  return templates.sort((a, b) => a.id.localeCompare(b.id));
}

export async function createTemplateScreen(
  projectPath: string,
  rawId: unknown,
  rawLocale: unknown,
  lockOptions: ProjectLockOptions = {},
): Promise<{ project: Project; revision: string; screen: Screen; template: ScreenTemplate }> {
  const id = templateId(rawId);
  const canonicalPath = await resolveExistingProjectPath(projectPath);
  const template = await loadCanonicalTemplate(canonicalPath, id);
  const locale = templateLocale(rawLocale);
  const updated = await updateProjectFile(canonicalPath, (current) => {
    try {
      const result = createScreenFromTemplate(current, template, locale);
      return { project: result.project, value: result.screen.id };
    } catch (error) {
      throw new TemplateCreateError((error as Error).message, { cause: error });
    }
  }, lockOptions);
  const screen = updated.project.screens.find((candidate) => candidate.id === updated.value)!;
  return { project: updated.project, revision: updated.revision, screen, template };
}
