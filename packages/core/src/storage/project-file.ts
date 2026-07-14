// SPDX-License-Identifier: Apache-2.0
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, type FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parseProjectJson, Project, type Project as ProjectModel } from "../model/index.js";

export interface ProjectSnapshot {
  project: ProjectModel;
  revision: string;
}

export class ProjectRevisionConflictError extends Error {
  override name = "ProjectRevisionConflictError";

  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`Project revision conflict: expected ${expected}, found ${actual}`);
  }
}

type WritableStageHandle = Pick<FileHandle, "writeFile" | "sync" | "close">;
type DirectoryHandle = Pick<FileHandle, "sync" | "close">;

export interface ProjectFileDependencies {
  randomId?: () => string;
  openFile?: (path: string, flags: number, mode: number) => Promise<WritableStageHandle>;
  openDirectory?: (path: string) => Promise<DirectoryHandle>;
  move?: (source: string, destination: string) => Promise<void>;
  remove?: (path: string) => Promise<void>;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withCleanupError(primary: unknown, cleanup: unknown, action: string): AggregateError {
  return new AggregateError(
    [primary, cleanup],
    `${errorText(primary)}; ${action}: ${errorText(cleanup)}`,
    { cause: primary },
  );
}

export function projectRevision(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function serializeProject(project: ProjectModel): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

export async function readProjectSnapshot(projectPath: string): Promise<ProjectSnapshot> {
  const bytes = await readFile(projectPath, "utf8");
  return { project: parseProjectJson(bytes), revision: projectRevision(bytes) };
}

async function closeHandle(handle: WritableStageHandle): Promise<void> {
  await handle.close();
}

async function createOwnedStage(
  stagePath: string,
  bytes: string,
  openFile: NonNullable<ProjectFileDependencies["openFile"]>,
  remove: NonNullable<ProjectFileDependencies["remove"]>,
): Promise<void> {
  let handle: WritableStageHandle | undefined;
  let owned = false;
  let primaryError: unknown;
  try {
    const flags = constants.O_WRONLY
      | constants.O_CREAT
      | constants.O_EXCL
      | (constants.O_NOFOLLOW ?? 0);
    handle = await openFile(stagePath, flags, 0o666);
    owned = true;
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
  } catch (error) {
    primaryError = error;
  }

  if (handle) {
    try {
      await closeHandle(handle);
    } catch (closeError) {
      primaryError = primaryError
        ? withCleanupError(primaryError, closeError, "stage close failed")
        : closeError;
    }
  }

  if (primaryError) {
    if (owned) {
      try {
        await remove(stagePath);
      } catch (cleanupError) {
        throw withCleanupError(primaryError, cleanupError, "stage cleanup failed");
      }
    }
    throw primaryError;
  }
}

async function syncDirectoryBestEffort(
  directory: string,
  openDirectory: NonNullable<ProjectFileDependencies["openDirectory"]>,
): Promise<void> {
  let handle: DirectoryHandle | undefined;
  try {
    handle = await openDirectory(directory);
    await handle.sync();
  } catch {
    // Some supported filesystems do not permit directory fsync; the atomic rename already landed.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function writeProjectAtomic(
  projectPath: string,
  project: ProjectModel,
  dependencies: ProjectFileDependencies = {},
): Promise<ProjectSnapshot> {
  const validated = Project.parse(project);
  const bytes = serializeProject(validated);
  const directory = dirname(projectPath);
  await mkdir(directory, { recursive: true });

  const randomId = dependencies.randomId ?? randomUUID;
  const stagePath = join(directory, `.${basename(projectPath)}.${randomId()}.tmp`);
  const openFile = dependencies.openFile
    ?? ((path, flags, mode) => open(path, flags, mode));
  const openDirectory = dependencies.openDirectory
    ?? ((path) => open(path, constants.O_RDONLY));
  const move = dependencies.move ?? rename;
  const remove = dependencies.remove ?? ((path) => rm(path, { force: true }));

  await createOwnedStage(stagePath, bytes, openFile, remove);
  try {
    await move(stagePath, projectPath);
  } catch (error) {
    try {
      await remove(stagePath);
    } catch (cleanupError) {
      throw withCleanupError(error, cleanupError, "stage cleanup failed");
    }
    throw error;
  }

  await syncDirectoryBestEffort(directory, openDirectory);
  return { project: validated, revision: projectRevision(bytes) };
}
