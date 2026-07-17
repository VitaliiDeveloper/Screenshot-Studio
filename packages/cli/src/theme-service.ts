// SPDX-License-Identifier: Apache-2.0
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { applyTheme, parseThemeJson, type Theme } from "@screenshot-studio/core/themes";
import type { Project } from "@screenshot-studio/core/model";
import {
  resolveExistingProjectPath,
  type ProjectLockOptions,
} from "@screenshot-studio/core/storage";
import { updateProjectFile } from "./project-io.js";
import { resolveMutationLayout } from "./layout-commands.js";

const THEME_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface ThemeDefinitionHandle {
  stat: (options: { bigint: true }) => Promise<BigIntStats>;
  readFile: () => Promise<Buffer>;
  close: () => Promise<void>;
}

export interface ThemeServiceDependencies {
  openDefinition?: (path: string, flags: number) => Promise<ThemeDefinitionHandle>;
  lstatDefinitionPath?: (
    path: string,
    options: { bigint: true },
  ) => Promise<BigIntStats>;
  realpathDefinitionPath?: (path: string) => Promise<string>;
}

interface ThemeDirectoryBoundary {
  path: string;
  canonicalPath: string;
  device: bigint;
  inode: bigint;
}

interface MissingPathResult {
  kind: "missing";
  error: NodeJS.ErrnoException;
}

interface ThemeDefinitionRead {
  json: string;
  path: string;
}

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

export function themeId(value: unknown): string {
  if (typeof value !== "string" || !THEME_ID.test(value)) {
    throw new ThemeValidationError("Theme id must be a lowercase slug");
  }
  return value;
}

function themesDir(projectPath: string): string {
  return join(dirname(projectPath), "themes");
}

function isMissingPath(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function missingPathResult(error: unknown): MissingPathResult {
  return { kind: "missing", error: error as NodeJS.ErrnoException };
}

function isMissingResult(
  value: ThemeDirectoryBoundary | ThemeDefinitionRead | MissingPathResult | BigIntStats,
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
    `${errorMessage(primary)}; theme definition close failed: ${errorMessage(cleanup)}`,
    { cause: primary },
  );
}

function noFollowReadFlags(): number {
  return constants.O_RDONLY
    | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0)
    | (typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0);
}

function assertThemePathContained(
  projectPath: string,
  canonicalResourcePath: string,
  label: string,
): void {
  const projectRoot = dirname(projectPath);
  const fromRoot = relative(projectRoot, canonicalResourcePath);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new ThemeValidationError(
      `${label} must stay inside canonical project root ${projectRoot}`,
    );
  }
}

async function validateThemesDirectory(
  projectPath: string,
  dependencies: ThemeServiceDependencies = {},
): Promise<ThemeDirectoryBoundary | MissingPathResult> {
  const dir = themesDir(projectPath);
  let stats;
  try {
    stats = await (dependencies.lstatDefinitionPath ?? lstat)(dir, { bigint: true });
  } catch (error) {
    if (isMissingPath(error)) return missingPathResult(error);
    throw error;
  }
  if (stats.isSymbolicLink()) {
    throw new ThemeValidationError(
      `Theme definitions directory must not be a symbolic link: ${dir}`,
    );
  }
  if (!stats.isDirectory()) {
    throw new ThemeValidationError(`Theme definitions path must be a directory: ${dir}`);
  }
  let canonicalPath: string;
  try {
    canonicalPath = await (dependencies.realpathDefinitionPath ?? realpath)(dir);
  } catch (error) {
    if (isMissingPath(error)) return missingPathResult(error);
    throw error;
  }
  assertThemePathContained(projectPath, canonicalPath, "Theme definitions directory");
  return {
    path: dir,
    canonicalPath,
    device: stats.dev,
    inode: stats.ino,
  };
}

async function revalidateThemesDirectory(
  projectPath: string,
  expected: ThemeDirectoryBoundary,
  dependencies: ThemeServiceDependencies = {},
): Promise<void> {
  const current = await validateThemesDirectory(projectPath, dependencies);
  if (isMissingResult(current)) {
    throw new ThemeValidationError(`Theme definitions directory disappeared: ${expected.path}`, {
      cause: current.error,
    });
  }
  if (
    current.device !== expected.device
    || current.inode !== expected.inode
    || current.canonicalPath !== expected.canonicalPath
  ) {
    throw new ThemeValidationError(`Theme definitions directory changed while reading: ${expected.path}`);
  }
}

async function inspectThemeDefinitionLeaf(
  projectPath: string,
  path: string,
  dependencies: ThemeServiceDependencies,
): Promise<BigIntStats | MissingPathResult> {
  let stats: BigIntStats;
  try {
    stats = await (dependencies.lstatDefinitionPath ?? lstat)(path, { bigint: true });
  } catch (error) {
    if (isMissingPath(error)) return missingPathResult(error);
    throw error;
  }
  if (stats.isSymbolicLink()) {
    throw new ThemeValidationError(`Theme definition must not be a symbolic link: ${path}`);
  }
  if (!stats.isFile()) {
    throw new ThemeValidationError(`Theme definition must be a regular file: ${path}`);
  }
  let canonicalPath: string;
  try {
    canonicalPath = await (dependencies.realpathDefinitionPath ?? realpath)(path);
  } catch (error) {
    if (isMissingPath(error)) return missingPathResult(error);
    throw error;
  }
  assertThemePathContained(projectPath, canonicalPath, "Theme definition");
  return stats;
}

async function revalidateThemeDefinitionLeaf(
  projectPath: string,
  path: string,
  expected: BigIntStats,
  dependencies: ThemeServiceDependencies,
): Promise<void> {
  const current = await inspectThemeDefinitionLeaf(projectPath, path, dependencies);
  if (isMissingResult(current)) {
    throw new ThemeValidationError(`Theme definition disappeared while reading: ${path}`, {
      cause: current.error,
    });
  }
  if (current.dev !== expected.dev || current.ino !== expected.ino) {
    throw new ThemeValidationError(`Theme definition changed while reading: ${path}`);
  }
}

async function readCanonicalThemeDefinition(
  projectPath: string,
  filename: string,
  dependencies: ThemeServiceDependencies = {},
  expectedDirectory?: ThemeDirectoryBoundary,
): Promise<ThemeDefinitionRead | MissingPathResult> {
  let directory: ThemeDirectoryBoundary;
  if (expectedDirectory) {
    await revalidateThemesDirectory(projectPath, expectedDirectory, dependencies);
    directory = expectedDirectory;
  } else {
    const inspectedDirectory = await validateThemesDirectory(projectPath, dependencies);
    if (isMissingResult(inspectedDirectory)) return inspectedDirectory;
    directory = inspectedDirectory;
  }
  const path = join(directory.path, filename);
  const inspectedLeaf = await inspectThemeDefinitionLeaf(projectPath, path, dependencies);
  if (isMissingResult(inspectedLeaf)) return inspectedLeaf;
  await revalidateThemesDirectory(projectPath, directory, dependencies);

  const openDefinition = dependencies.openDefinition
    ?? (async (definitionPath: string, flags: number) => open(definitionPath, flags));
  let handle: ThemeDefinitionHandle;
  try {
    handle = await openDefinition(path, noFollowReadFlags());
  } catch (error) {
    if (hasCode(error, "ELOOP")) {
      throw new ThemeValidationError(`Theme definition must not be a symbolic link: ${path}`, {
        cause: error,
      });
    }
    if (isMissingPath(error)) return missingPathResult(error);
    throw error;
  }

  let result: ThemeDefinitionRead | undefined;
  let primaryError: unknown;
  let hasPrimaryError = false;
  try {
    await revalidateThemesDirectory(projectPath, directory, dependencies);
    const openedStats = await handle.stat({ bigint: true });
    if (!openedStats.isFile()) {
      throw new ThemeValidationError(`Theme definition must be a regular file: ${path}`);
    }
    if (openedStats.dev !== inspectedLeaf.dev || openedStats.ino !== inspectedLeaf.ino) {
      throw new ThemeValidationError(`Theme definition changed while it was opened: ${path}`);
    }
    await revalidateThemeDefinitionLeaf(projectPath, path, inspectedLeaf, dependencies);
    await revalidateThemesDirectory(projectPath, directory, dependencies);
    const bytes = await handle.readFile();
    await revalidateThemeDefinitionLeaf(projectPath, path, inspectedLeaf, dependencies);
    await revalidateThemesDirectory(projectPath, directory, dependencies);
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

function parseDefinition(json: string, path: string): Theme {
  try {
    return parseThemeJson(json);
  } catch (error) {
    throw new ThemeValidationError(`Invalid theme at ${path}: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

async function loadCanonicalTheme(
  projectPath: string,
  id: string,
  dependencies: ThemeServiceDependencies = {},
): Promise<Theme> {
  const path = join(themesDir(projectPath), `${id}.json`);
  const definition = await readCanonicalThemeDefinition(projectPath, `${id}.json`, dependencies);
  if (isMissingResult(definition)) {
    throw new ThemeNotFoundError(`Theme "${id}" not found at ${path}`, {
      cause: definition.error,
    });
  }
  const theme = parseDefinition(definition.json, definition.path);
  if (theme.id !== id) {
    throw new ThemeValidationError(
      `Theme file id "${theme.id}" does not match requested id "${id}"`,
    );
  }
  return theme;
}

export async function loadTheme(
  projectPath: string,
  rawId: unknown,
  dependencies: ThemeServiceDependencies = {},
): Promise<Theme> {
  const id = themeId(rawId);
  return loadCanonicalTheme(await resolveExistingProjectPath(projectPath), id, dependencies);
}

export async function listThemes(
  projectPath: string,
  dependencies: ThemeServiceDependencies = {},
): Promise<Theme[]> {
  const canonicalProjectPath = await resolveExistingProjectPath(projectPath);
  const directory = await validateThemesDirectory(canonicalProjectPath, dependencies);
  if (isMissingResult(directory)) return [];
  let entries;
  try {
    entries = await readdir(directory.path, { withFileTypes: true });
  } catch (error) {
    if (isMissingPath(error)) return [];
    throw error;
  }
  await revalidateThemesDirectory(canonicalProjectPath, directory, dependencies);
  const definitionEntries = entries.filter((entry) => entry.name.endsWith(".json"));
  const linkedEntry = definitionEntries.find((entry) => entry.isSymbolicLink());
  if (linkedEntry) {
    throw new ThemeValidationError(
      `Theme definition must not be a symbolic link: ${join(directory.path, linkedEntry.name)}`,
    );
  }
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  const themes = await Promise.all(files.map(async (file) => {
    const definition = await readCanonicalThemeDefinition(
      canonicalProjectPath,
      file,
      dependencies,
      directory,
    );
    if (isMissingResult(definition)) {
      throw new ThemeValidationError(
        `Theme definition disappeared while listing: ${join(directory.path, file)}`,
        { cause: definition.error },
      );
    }
    const theme = parseDefinition(definition.json, definition.path);
    if (`${theme.id}.json` !== file) {
      throw new ThemeValidationError(`Theme file ${file} must match its id "${theme.id}"`);
    }
    return theme;
  }));
  return themes.sort((a, b) => a.id.localeCompare(b.id));
}

export async function applyThemeFile(
  projectPath: string,
  rawId: unknown,
  lockOptions: ProjectLockOptions = {},
  layoutReference?: string,
): Promise<{
  project: Project;
  revision: string;
  theme: Theme;
}> {
  const id = themeId(rawId);
  const canonicalPath = await resolveExistingProjectPath(projectPath);
  const theme = await loadCanonicalTheme(canonicalPath, id);
  const updated = await updateProjectFile(canonicalPath, (current) => {
    try {
      const layout = resolveMutationLayout(current, layoutReference);
      return { project: applyTheme(current, layout.id, theme), value: undefined };
    } catch (error) {
      throw new ThemeApplyError((error as Error).message, { cause: error });
    }
  }, lockOptions);
  return { project: updated.project, revision: updated.revision, theme };
}
