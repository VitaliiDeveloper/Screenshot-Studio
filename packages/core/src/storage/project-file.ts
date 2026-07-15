// SPDX-License-Identifier: Apache-2.0
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, rename, rm, type FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parseProjectJson, Project, type Project as ProjectModel } from "../model/index.js";
import {
  ProjectPathError,
  createProjectCreationIntent,
  inspectProjectPublicationFile,
  isProjectCreationToken,
  projectCreationIntentPath,
  projectCreationStagePath,
  projectPublicationFileMatches,
  recoverOwnedProjectStages,
  serializeProjectCreationIntent,
  type ProjectPublicationEvidence,
} from "./project-path.js";

export interface ProjectSnapshot {
  project: ProjectModel;
  revision: string;
}

export interface ProjectFileIdentity {
  device: bigint;
  inode: bigint;
}

export interface IdentifiedProjectSnapshot extends ProjectSnapshot {
  identity: ProjectFileIdentity;
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
type ReadableSnapshotHandle = Pick<FileHandle, "stat" | "readFile" | "close">;

export interface ProjectFileDependencies {
  randomId?: () => string;
  openFile?: (path: string, flags: number, mode: number) => Promise<WritableStageHandle>;
  openSnapshot?: (path: string, flags: number) => Promise<ReadableSnapshotHandle>;
  openDirectory?: (path: string) => Promise<DirectoryHandle>;
  linkFile?: (source: string, destination: string) => Promise<void>;
  move?: (source: string, destination: string) => Promise<void>;
  remove?: (path: string) => Promise<void>;
  beforeSnapshotOpen?: (projectPath: string) => Promise<void>;
  beforeDestinationRevalidation?: (projectPath: string) => Promise<void>;
  beforeCreatePublication?: (projectPath: string) => Promise<void>;
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

function noFollowFlags(base: number): number {
  if (typeof constants.O_NOFOLLOW !== "number") {
    throw new ProjectPathError("Safe project snapshots require O_NOFOLLOW support");
  }
  return base | constants.O_NOFOLLOW;
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function projectOpenError(projectPath: string, error: unknown): ProjectPathError {
  if (errorCode(error) === "ELOOP" || errorCode(error) === "EMLINK") {
    return new ProjectPathError(
      `Project path became a symbolic link before its no-follow snapshot was opened: ${projectPath}`,
      { cause: error },
    );
  }
  return new ProjectPathError(
    `Unable to open project path without following links ${projectPath}: ${errorText(error)}`,
    { cause: error },
  );
}

async function readIdentifiedProjectBytes(
  projectPath: string,
  dependencies: ProjectFileDependencies,
): Promise<{ bytes: Buffer; revision: string; identity: ProjectFileIdentity }> {
  await dependencies.beforeSnapshotOpen?.(projectPath);
  const openSnapshot = dependencies.openSnapshot ?? ((path, flags) => open(path, flags));
  let handle: ReadableSnapshotHandle;
  try {
    handle = await openSnapshot(projectPath, noFollowFlags(constants.O_RDONLY));
  } catch (error) {
    throw projectOpenError(projectPath, error);
  }

  let primaryError: unknown;
  let hasPrimaryError = false;
  let result: { bytes: Buffer; revision: string; identity: ProjectFileIdentity } | undefined;
  try {
    let stats = await handle.stat({ bigint: true });
    if (!stats.isFile()) {
      throw new ProjectPathError(`Project path must be a regular file: ${projectPath}`);
    }
    await recoverOwnedProjectStages(projectPath, { device: stats.dev, inode: stats.ino });
    stats = await handle.stat({ bigint: true });
    if (stats.nlink !== 1n) {
      throw new ProjectPathError(
        `Project file has ${stats.nlink} hard links and cannot have one mutation identity: ${projectPath}. `
        + "Copy it to a new file before opening it",
      );
    }
    const bytes = await handle.readFile();
    result = {
      bytes,
      revision: projectRevision(bytes),
      identity: { device: stats.dev, inode: stats.ino },
    };
  } catch (error) {
    primaryError = error;
    hasPrimaryError = true;
  }

  try {
    await handle.close();
  } catch (closeError) {
    primaryError = hasPrimaryError
      ? withCleanupError(primaryError, closeError, "snapshot close failed")
      : closeError;
    hasPrimaryError = true;
  }

  if (hasPrimaryError) throw primaryError;
  return result!;
}

export async function readIdentifiedProjectSnapshot(
  projectPath: string,
  dependencies: ProjectFileDependencies = {},
): Promise<IdentifiedProjectSnapshot> {
  const snapshot = await readIdentifiedProjectBytes(projectPath, dependencies);
  return {
    project: parseProjectJson(snapshot.bytes.toString("utf8")),
    revision: snapshot.revision,
    identity: snapshot.identity,
  };
}

export async function readProjectSnapshot(
  projectPath: string,
  dependencies: ProjectFileDependencies = {},
): Promise<ProjectSnapshot> {
  const { project, revision } = await readIdentifiedProjectSnapshot(projectPath, dependencies);
  return { project, revision };
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
  let hasPrimaryError = false;
  try {
    const flags = noFollowFlags(constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
    handle = await openFile(stagePath, flags, 0o666);
    owned = true;
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
  } catch (error) {
    primaryError = error;
    hasPrimaryError = true;
  }

  if (handle) {
    try {
      await handle.close();
    } catch (closeError) {
      primaryError = hasPrimaryError
        ? withCleanupError(primaryError, closeError, "stage close failed")
        : closeError;
      hasPrimaryError = true;
    }
  }

  if (hasPrimaryError) {
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
    // Some supported local filesystems do not permit directory fsync.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function projectIdentitiesMatch(left: ProjectFileIdentity, right: ProjectFileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function projectWriteDependencies(dependencies: ProjectFileDependencies): {
  randomId: () => string;
  openFile: NonNullable<ProjectFileDependencies["openFile"]>;
  openDirectory: NonNullable<ProjectFileDependencies["openDirectory"]>;
  linkFile: NonNullable<ProjectFileDependencies["linkFile"]>;
  move: NonNullable<ProjectFileDependencies["move"]>;
  remove: NonNullable<ProjectFileDependencies["remove"]>;
} {
  return {
    randomId: dependencies.randomId ?? randomUUID,
    openFile: dependencies.openFile ?? ((path, flags, mode) => open(path, flags, mode)),
    openDirectory: dependencies.openDirectory ?? ((path) => open(path, constants.O_RDONLY)),
    linkFile: dependencies.linkFile ?? link,
    move: dependencies.move ?? rename,
    remove: dependencies.remove ?? ((path) => rm(path, { force: true })),
  };
}

function projectStagePath(projectPath: string, randomId: () => string): string {
  return join(dirname(projectPath), `.${basename(projectPath)}.${randomId()}.tmp`);
}

async function removeFailedStage(
  stagePath: string,
  remove: NonNullable<ProjectFileDependencies["remove"]>,
  primaryError: unknown,
): Promise<never> {
  try {
    await remove(stagePath);
  } catch (cleanupError) {
    throw withCleanupError(primaryError, cleanupError, "stage cleanup failed");
  }
  throw primaryError;
}

function publicationEvidenceMatches(
  left: ProjectPublicationEvidence,
  right: ProjectPublicationEvidence,
): boolean {
  return left.revision === right.revision
    && left.identity.device === right.identity.device
    && left.identity.inode === right.identity.inode;
}

async function removeTrackedPublicationFile(
  path: string,
  evidence: ProjectPublicationEvidence,
  remove: NonNullable<ProjectFileDependencies["remove"]>,
): Promise<boolean> {
  if (!(await projectPublicationFileMatches(path, evidence))) return false;
  // Node has no portable unlinkat-by-handle; keep this revalidation immediately adjacent to the
  // pathname removal and retain the final namespace window in the local-filesystem contract.
  await remove(path);
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return true;
    throw error;
  }
}

async function cleanupFailedCreation(
  stagePath: string,
  stageEvidence: ProjectPublicationEvidence,
  intentPath: string,
  intentEvidence: ProjectPublicationEvidence,
  remove: NonNullable<ProjectFileDependencies["remove"]>,
  primaryError: unknown,
): Promise<never> {
  let combinedError = primaryError;
  for (const [path, evidence, label] of [
    [intentPath, intentEvidence, "creation intent cleanup failed"],
    [stagePath, stageEvidence, "stage cleanup failed"],
  ] as const) {
    try {
      if (!(await removeTrackedPublicationFile(path, evidence, remove))) {
        throw new Error(`Tracked publication file changed or remained visible: ${path}`);
      }
    } catch (cleanupError) {
      combinedError = withCleanupError(combinedError, cleanupError, label);
    }
  }
  throw combinedError;
}

export async function writeProjectConditionalAtomic(
  projectPath: string,
  project: ProjectModel,
  expected: IdentifiedProjectSnapshot,
  dependencies: ProjectFileDependencies = {},
): Promise<ProjectSnapshot> {
  const validated = Project.parse(project);
  const bytes = serializeProject(validated);
  const directory = dirname(projectPath);
  await mkdir(directory, { recursive: true });
  const resolved = projectWriteDependencies(dependencies);
  const stagePath = projectStagePath(projectPath, resolved.randomId);

  await createOwnedStage(stagePath, bytes, resolved.openFile, resolved.remove);
  try {
    await dependencies.beforeDestinationRevalidation?.(projectPath);
    const current = await readIdentifiedProjectBytes(projectPath, {
      openSnapshot: dependencies.openSnapshot,
    });
    if (
      current.revision !== expected.revision
      || !projectIdentitiesMatch(current.identity, expected.identity)
    ) {
      throw new ProjectRevisionConflictError(expected.revision, current.revision);
    }

    // Node has no directory-handle renameat/compare-exchange. This immediate revalidation narrows,
    // but cannot eliminate, the final local-filesystem window before the owned rename.
    await resolved.move(stagePath, projectPath);
  } catch (error) {
    return removeFailedStage(stagePath, resolved.remove, error);
  }

  await syncDirectoryBestEffort(directory, resolved.openDirectory);
  return { project: validated, revision: projectRevision(bytes) };
}

export async function createProjectAtomic(
  projectPath: string,
  project: ProjectModel,
  dependencies: ProjectFileDependencies = {},
): Promise<ProjectSnapshot> {
  const validated = Project.parse(project);
  const bytes = serializeProject(validated);
  const directory = dirname(projectPath);
  await mkdir(directory, { recursive: true });
  const resolved = projectWriteDependencies(dependencies);
  const token = resolved.randomId();
  if (!isProjectCreationToken(token)) {
    throw new ProjectPathError(`Project creation requires a UUID-v4 publication token, received ${token}`);
  }
  const revision = projectRevision(bytes);
  const stagePath = projectCreationStagePath(projectPath, token);
  const intentPath = projectCreationIntentPath(projectPath, token);

  await createOwnedStage(stagePath, bytes, resolved.openFile, resolved.remove);
  let stageEvidence: ProjectPublicationEvidence;
  try {
    stageEvidence = await inspectProjectPublicationFile(stagePath);
    if (stageEvidence.links !== 1n || stageEvidence.revision !== revision) {
      throw new ProjectPathError(`Owned project stage changed before intent publication: ${stagePath}`);
    }
  } catch (error) {
    return removeFailedStage(stagePath, resolved.remove, error);
  }

  const intent = createProjectCreationIntent(projectPath, token, revision, stageEvidence.identity);
  const intentBytes = serializeProjectCreationIntent(intent);
  try {
    await createOwnedStage(intentPath, intentBytes, resolved.openFile, resolved.remove);
  } catch (error) {
    return removeFailedStage(stagePath, resolved.remove, error);
  }

  let intentEvidence: ProjectPublicationEvidence;
  try {
    intentEvidence = await inspectProjectPublicationFile(intentPath);
    if (intentEvidence.links !== 1n || intentEvidence.revision !== projectRevision(intentBytes)) {
      throw new ProjectPathError(`Project creation intent changed before publication: ${intentPath}`);
    }
    await syncDirectoryBestEffort(directory, resolved.openDirectory);
  } catch (error) {
    return removeFailedStage(stagePath, resolved.remove, error);
  }

  try {
    await dependencies.beforeCreatePublication?.(projectPath);
    const currentStage = await inspectProjectPublicationFile(stagePath);
    const currentIntent = await inspectProjectPublicationFile(intentPath);
    if (
      currentStage.links !== 1n
      || currentIntent.links !== 1n
      || !publicationEvidenceMatches(currentStage, stageEvidence)
      || !publicationEvidenceMatches(currentIntent, intentEvidence)
    ) {
      throw new ProjectPathError("Project creation stage or durable intent changed before publication");
    }
    await resolved.linkFile(stagePath, projectPath);
  } catch (error) {
    return cleanupFailedCreation(
      stagePath,
      stageEvidence,
      intentPath,
      intentEvidence,
      resolved.remove,
      error,
    );
  }

  const stageRemoved = await removeTrackedPublicationFile(
    stagePath,
    stageEvidence,
    resolved.remove,
  ).catch(() => false);
  if (stageRemoved) {
    await removeTrackedPublicationFile(intentPath, intentEvidence, resolved.remove).catch(() => false);
  }
  await syncDirectoryBestEffort(directory, resolved.openDirectory);
  return { project: validated, revision };
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

  const resolved = projectWriteDependencies(dependencies);
  const stagePath = projectStagePath(projectPath, resolved.randomId);

  await createOwnedStage(stagePath, bytes, resolved.openFile, resolved.remove);
  try {
    await resolved.move(stagePath, projectPath);
  } catch (error) {
    try {
      await resolved.remove(stagePath);
    } catch (cleanupError) {
      throw withCleanupError(error, cleanupError, "stage cleanup failed");
    }
    throw error;
  }

  await syncDirectoryBestEffort(directory, resolved.openDirectory);
  return { project: validated, revision: projectRevision(bytes) };
}
