// SPDX-License-Identifier: Apache-2.0
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { errorText, noFollowFlags, resolveExistingProjectPath } from "@screenshot-studio/core/storage";

/** Ids of project definition files: lowercase slugs, stored as `<id>.json`. */
export const DEFINITION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface DefinitionHandle {
  stat: (options: { bigint: true }) => Promise<BigIntStats>;
  readFile: () => Promise<Buffer>;
  close: () => Promise<void>;
}

export interface DefinitionStoreDependencies {
  openDefinition?: (path: string, flags: number) => Promise<DefinitionHandle>;
  lstatDefinitionPath?: (
    path: string,
    options: { bigint: true },
  ) => Promise<BigIntStats>;
  realpathDefinitionPath?: (path: string) => Promise<string>;
}

type DefinitionErrorClass = new (message: string, options?: ErrorOptions) => Error;

export interface DefinitionStoreConfig<T extends { id: string }> {
  /** Directory next to the project file, e.g. `templates`. */
  directoryName: string;
  /** Capitalised noun used in every error message, e.g. `Template`. */
  noun: string;
  parse: (json: string) => T;
  ValidationError: DefinitionErrorClass;
  NotFoundError: DefinitionErrorClass;
}

export interface DefinitionStore<T> {
  /** Loads `<id>.json`; `canonicalProjectPath` must already be resolved and `id` validated. */
  load: (
    canonicalProjectPath: string,
    id: string,
    dependencies?: DefinitionStoreDependencies,
  ) => Promise<T>;
  /** Lists every definition, sorted by id; a missing directory is an empty list. */
  list: (projectPath: string, dependencies?: DefinitionStoreDependencies) => Promise<T[]>;
}

interface DefinitionDirectoryBoundary {
  path: string;
  canonicalPath: string;
  device: bigint;
  inode: bigint;
}

interface MissingPathResult {
  kind: "missing";
  error: NodeJS.ErrnoException;
}

interface DefinitionRead {
  json: string;
  path: string;
}

function isMissingPath(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function missingPathResult(error: unknown): MissingPathResult {
  return { kind: "missing", error: error as NodeJS.ErrnoException };
}

function isMissingResult(
  value: DefinitionDirectoryBoundary | DefinitionRead | MissingPathResult | BigIntStats,
): value is MissingPathResult {
  return "kind" in value && value.kind === "missing";
}

function hasCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === code;
}

function noFollowReadFlags(): number {
  return noFollowFlags(constants.O_RDONLY)
    | (typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0);
}

/**
 * Reads JSON definitions from one project-owned directory without following links: the directory
 * and each file are bound by device/inode and revalidated around open and read.
 */
export function createDefinitionStore<T extends { id: string }>({
  directoryName,
  noun,
  parse,
  ValidationError,
  NotFoundError,
}: DefinitionStoreConfig<T>): DefinitionStore<T> {
  const lowerNoun = noun.toLowerCase();

  function definitionsDir(projectPath: string): string {
    return join(dirname(projectPath), directoryName);
  }

  function withCloseError(primary: unknown, cleanup: unknown): AggregateError {
    return new AggregateError(
      [primary, cleanup],
      `${errorText(primary)}; ${lowerNoun} definition close failed: ${errorText(cleanup)}`,
      { cause: primary },
    );
  }

  function assertPathContained(
    projectPath: string,
    canonicalResourcePath: string,
    label: string,
  ): void {
    const projectRoot = dirname(projectPath);
    const fromRoot = relative(projectRoot, canonicalResourcePath);
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new ValidationError(
        `${label} must stay inside canonical project root ${projectRoot}`,
      );
    }
  }

  async function validateDirectory(
    projectPath: string,
    dependencies: DefinitionStoreDependencies = {},
  ): Promise<DefinitionDirectoryBoundary | MissingPathResult> {
    const dir = definitionsDir(projectPath);
    let stats;
    try {
      stats = await (dependencies.lstatDefinitionPath ?? lstat)(dir, { bigint: true });
    } catch (error) {
      if (isMissingPath(error)) return missingPathResult(error);
      throw error;
    }
    if (stats.isSymbolicLink()) {
      throw new ValidationError(
        `${noun} definitions directory must not be a symbolic link: ${dir}`,
      );
    }
    if (!stats.isDirectory()) {
      throw new ValidationError(`${noun} definitions path must be a directory: ${dir}`);
    }
    let canonicalPath: string;
    try {
      canonicalPath = await (dependencies.realpathDefinitionPath ?? realpath)(dir);
    } catch (error) {
      if (isMissingPath(error)) return missingPathResult(error);
      throw error;
    }
    assertPathContained(projectPath, canonicalPath, `${noun} definitions directory`);
    return {
      path: dir,
      canonicalPath,
      device: stats.dev,
      inode: stats.ino,
    };
  }

  async function revalidateDirectory(
    projectPath: string,
    expected: DefinitionDirectoryBoundary,
    dependencies: DefinitionStoreDependencies = {},
  ): Promise<void> {
    const current = await validateDirectory(projectPath, dependencies);
    if (isMissingResult(current)) {
      throw new ValidationError(
        `${noun} definitions directory disappeared: ${expected.path}`,
        { cause: current.error },
      );
    }
    if (
      current.device !== expected.device
      || current.inode !== expected.inode
      || current.canonicalPath !== expected.canonicalPath
    ) {
      throw new ValidationError(
        `${noun} definitions directory changed while reading: ${expected.path}`,
      );
    }
  }

  async function inspectDefinitionLeaf(
    projectPath: string,
    path: string,
    dependencies: DefinitionStoreDependencies,
  ): Promise<BigIntStats | MissingPathResult> {
    let stats: BigIntStats;
    try {
      stats = await (dependencies.lstatDefinitionPath ?? lstat)(path, { bigint: true });
    } catch (error) {
      if (isMissingPath(error)) return missingPathResult(error);
      throw error;
    }
    if (stats.isSymbolicLink()) {
      throw new ValidationError(`${noun} definition must not be a symbolic link: ${path}`);
    }
    if (!stats.isFile()) {
      throw new ValidationError(`${noun} definition must be a regular file: ${path}`);
    }
    let canonicalPath: string;
    try {
      canonicalPath = await (dependencies.realpathDefinitionPath ?? realpath)(path);
    } catch (error) {
      if (isMissingPath(error)) return missingPathResult(error);
      throw error;
    }
    assertPathContained(projectPath, canonicalPath, `${noun} definition`);
    return stats;
  }

  async function revalidateDefinitionLeaf(
    projectPath: string,
    path: string,
    expected: BigIntStats,
    dependencies: DefinitionStoreDependencies,
  ): Promise<void> {
    const current = await inspectDefinitionLeaf(projectPath, path, dependencies);
    if (isMissingResult(current)) {
      throw new ValidationError(`${noun} definition disappeared while reading: ${path}`, {
        cause: current.error,
      });
    }
    if (current.dev !== expected.dev || current.ino !== expected.ino) {
      throw new ValidationError(`${noun} definition changed while reading: ${path}`);
    }
  }

  async function readCanonicalDefinition(
    projectPath: string,
    filename: string,
    dependencies: DefinitionStoreDependencies = {},
    expectedDirectory?: DefinitionDirectoryBoundary,
  ): Promise<DefinitionRead | MissingPathResult> {
    let directory: DefinitionDirectoryBoundary;
    if (expectedDirectory) {
      await revalidateDirectory(projectPath, expectedDirectory, dependencies);
      directory = expectedDirectory;
    } else {
      const inspectedDirectory = await validateDirectory(projectPath, dependencies);
      if (isMissingResult(inspectedDirectory)) return inspectedDirectory;
      directory = inspectedDirectory;
    }
    const path = join(directory.path, filename);
    const inspectedLeaf = await inspectDefinitionLeaf(projectPath, path, dependencies);
    if (isMissingResult(inspectedLeaf)) return inspectedLeaf;
    await revalidateDirectory(projectPath, directory, dependencies);

    const openDefinition = dependencies.openDefinition
      ?? (async (definitionPath: string, flags: number) => open(definitionPath, flags));
    let handle: DefinitionHandle;
    try {
      handle = await openDefinition(path, noFollowReadFlags());
    } catch (error) {
      if (hasCode(error, "ELOOP")) {
        throw new ValidationError(
          `${noun} definition must not be a symbolic link: ${path}`,
          { cause: error },
        );
      }
      if (isMissingPath(error)) return missingPathResult(error);
      throw error;
    }

    let result: DefinitionRead | undefined;
    let primaryError: unknown;
    let hasPrimaryError = false;
    try {
      await revalidateDirectory(projectPath, directory, dependencies);
      const openedStats = await handle.stat({ bigint: true });
      if (!openedStats.isFile()) {
        throw new ValidationError(`${noun} definition must be a regular file: ${path}`);
      }
      if (openedStats.dev !== inspectedLeaf.dev || openedStats.ino !== inspectedLeaf.ino) {
        throw new ValidationError(`${noun} definition changed while it was opened: ${path}`);
      }
      await revalidateDefinitionLeaf(projectPath, path, inspectedLeaf, dependencies);
      await revalidateDirectory(projectPath, directory, dependencies);
      const bytes = await handle.readFile();
      await revalidateDefinitionLeaf(projectPath, path, inspectedLeaf, dependencies);
      await revalidateDirectory(projectPath, directory, dependencies);
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

  function parseDefinition(json: string, path: string): T {
    try {
      return parse(json);
    } catch (error) {
      throw new ValidationError(`Invalid ${lowerNoun} at ${path}: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }

  async function load(
    projectPath: string,
    id: string,
    dependencies: DefinitionStoreDependencies = {},
  ): Promise<T> {
    const path = join(definitionsDir(projectPath), `${id}.json`);
    const definition = await readCanonicalDefinition(projectPath, `${id}.json`, dependencies);
    if (isMissingResult(definition)) {
      throw new NotFoundError(`${noun} "${id}" not found at ${path}`, {
        cause: definition.error,
      });
    }
    const loaded = parseDefinition(definition.json, definition.path);
    if (loaded.id !== id) {
      throw new ValidationError(
        `${noun} file id "${loaded.id}" does not match requested id "${id}"`,
      );
    }
    return loaded;
  }

  async function list(
    projectPath: string,
    dependencies: DefinitionStoreDependencies = {},
  ): Promise<T[]> {
    const canonicalProjectPath = await resolveExistingProjectPath(projectPath);
    const directory = await validateDirectory(canonicalProjectPath, dependencies);
    if (isMissingResult(directory)) return [];
    let entries;
    try {
      entries = await readdir(directory.path, { withFileTypes: true });
    } catch (error) {
      if (isMissingPath(error)) return [];
      throw error;
    }
    await revalidateDirectory(canonicalProjectPath, directory, dependencies);
    const definitionEntries = entries.filter((entry) => entry.name.endsWith(".json"));
    const linkedEntry = definitionEntries.find((entry) => entry.isSymbolicLink());
    if (linkedEntry) {
      throw new ValidationError(
        `${noun} definition must not be a symbolic link: ${join(directory.path, linkedEntry.name)}`,
      );
    }
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
    const definitions = await Promise.all(files.map(async (file) => {
      const definition = await readCanonicalDefinition(
        canonicalProjectPath,
        file,
        dependencies,
        directory,
      );
      if (isMissingResult(definition)) {
        throw new ValidationError(
          `${noun} definition disappeared while listing: ${join(directory.path, file)}`,
          { cause: definition.error },
        );
      }
      const parsed = parseDefinition(definition.json, definition.path);
      if (`${parsed.id}.json` !== file) {
        throw new ValidationError(`${noun} file ${file} must match its id "${parsed.id}"`);
      }
      return parsed;
    }));
    return definitions.sort((a, b) => a.id.localeCompare(b.id));
  }

  return { load, list };
}
