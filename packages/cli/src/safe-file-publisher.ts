// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isProjectRelativePath } from "@screenshot-studio/core/model";

export interface SafeFilePublication {
  root: string;
  relativePath: string;
  bytes: Uint8Array;
  replace?: boolean;
}

export class SafeFileConflictError extends Error {
  override name = "SafeFileConflictError";
  readonly code = "SAFE_FILE_CONFLICT" as const;

  constructor(readonly path: string) {
    super(`Publication destination already exists with different bytes: ${path}`);
  }
}

type StageHandle = Pick<FileHandle, "writeFile" | "sync" | "close">
  & Partial<Pick<FileHandle, "stat">>;

interface StageIdentity {
  device: number;
  inode: number;
}

interface PublicationDependencies {
  randomId?: () => string;
  openStage?: (path: string, flags: number, mode: number) => Promise<StageHandle>;
  linkFile?: (source: string, destination: string) => Promise<void>;
  moveFile?: (source: string, destination: string) => Promise<void>;
  removeStage?: (path: string) => Promise<void>;
  beforePublication?: (context: {
    destinationPath: string;
    stagePath: string;
    mode: "create-only" | "replace";
  }) => Promise<void>;
}

interface RootBoundary {
  requestedRoot: string;
  canonicalRoot: string;
}

interface RootCreationPlan {
  requestedRoot: string;
  anchor: RootBoundary;
  missingSegments: string[];
}

interface CapturedError {
  value: unknown;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorWithCleanup(primary: unknown, cleanup: unknown): AggregateError {
  return new AggregateError(
    [primary, cleanup],
    `${errorText(primary)}; stage cleanup failed: ${errorText(cleanup)}`,
    { cause: primary },
  );
}

function hasCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === code;
}

async function lstatIfExists(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
}

function assertPortableRelativePath(relativePath: string): void {
  if (!isProjectRelativePath(relativePath)) {
    throw new Error(`Expected a portable project-relative path, received ${JSON.stringify(relativePath)}`);
  }
}

function assertCanonicalContainment(root: string, path: string): void {
  const fromRoot = relative(root, path);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Resolved path escaped the canonical publication root: ${path}`);
  }
}

function assertRootStats(stats: Stats | null): asserts stats is Stats {
  if (!stats) throw new Error("Publication root must be an existing directory");
  if (stats.isSymbolicLink()) throw new Error("Unsafe symbolic link at publication root");
  if (!stats.isDirectory()) throw new Error("Publication root is not a directory");
}

async function resolveRootBoundary(root: string): Promise<RootBoundary> {
  const requestedRoot = resolve(root);
  assertRootStats(await lstatIfExists(requestedRoot));
  const canonicalRoot = await realpath(requestedRoot);
  assertRootStats(await lstatIfExists(canonicalRoot));
  return { requestedRoot, canonicalRoot };
}

async function revalidateRoot(boundary: RootBoundary): Promise<void> {
  assertRootStats(await lstatIfExists(boundary.requestedRoot));
  const currentCanonicalRoot = await realpath(boundary.requestedRoot);
  if (currentCanonicalRoot !== boundary.canonicalRoot) {
    throw new Error("Publication root changed after its canonical boundary was established");
  }
  assertRootStats(await lstatIfExists(boundary.canonicalRoot));
}

function assertAncestorStats(path: string, stats: Stats | null): asserts stats is Stats {
  if (!stats) throw new Error(`Publication path ancestor disappeared: ${path}`);
  if (stats.isSymbolicLink()) {
    throw new Error(`Unsafe symbolic link in publication path ancestor: ${path}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Publication path ancestor is not a directory: ${path}`);
  }
}

async function revalidateAncestors(boundary: RootBoundary, ancestors: string[]): Promise<void> {
  await revalidateRoot(boundary);
  for (const ancestor of ancestors) {
    assertAncestorStats(ancestor, await lstatIfExists(ancestor));
    const canonicalAncestor = await realpath(ancestor);
    assertCanonicalContainment(boundary.canonicalRoot, canonicalAncestor);
  }
}

async function ensureAncestors(
  boundary: RootBoundary,
  segments: string[],
  createMissing: boolean,
): Promise<string[] | null> {
  const ancestors: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const ancestor = join(boundary.canonicalRoot, ...segments.slice(0, index + 1));
    let stats = await lstatIfExists(ancestor);
    if (!stats) {
      if (!createMissing) return null;
      await revalidateAncestors(boundary, ancestors);
      try {
        await mkdir(ancestor);
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
      }
      stats = await lstatIfExists(ancestor);
    }
    assertAncestorStats(ancestor, stats);
    const canonicalAncestor = await realpath(ancestor);
    assertCanonicalContainment(boundary.canonicalRoot, canonicalAncestor);
    ancestors.push(ancestor);
  }
  return ancestors;
}

async function planRootCreation(root: string): Promise<RootCreationPlan> {
  const requestedRoot = resolve(root);
  const missingSegments: string[] = [];
  let cursor = requestedRoot;

  for (;;) {
    let stats: Stats | null;
    try {
      stats = await lstat(cursor);
    } catch (error) {
      if (!hasCode(error, "ENOENT") && !hasCode(error, "ENOTDIR")) throw error;
      stats = null;
    }

    if (stats) {
      const describesRequestedRoot = missingSegments.length === 0;
      if (stats.isSymbolicLink()) {
        throw new Error(describesRequestedRoot
          ? "Unsafe symbolic link at publication root"
          : `Unsafe symbolic link in publication root ancestry: ${cursor}`);
      }
      if (!stats.isDirectory()) {
        throw new Error(describesRequestedRoot
          ? "Publication root is not a directory"
          : `Publication root ancestry is not a directory: ${cursor}`);
      }
      const canonicalRoot = await realpath(cursor);
      assertRootStats(await lstatIfExists(canonicalRoot));
      return {
        requestedRoot,
        anchor: { requestedRoot: cursor, canonicalRoot },
        missingSegments,
      };
    }

    const parent = dirname(cursor);
    if (parent === cursor) throw new Error("Publication root has no existing directory ancestor");
    missingSegments.unshift(basename(cursor));
    cursor = parent;
  }
}

async function resolveOrCreateRootBoundary(root: string): Promise<RootBoundary> {
  const plan = await planRootCreation(root);
  if (plan.missingSegments.length === 0) return plan.anchor;
  await ensureAncestors(plan.anchor, plan.missingSegments, true);
  return resolveRootBoundary(plan.requestedRoot);
}

async function resolveRootBoundaryIfExists(root: string): Promise<RootBoundary | null> {
  const plan = await planRootCreation(root);
  return plan.missingSegments.length === 0 ? plan.anchor : null;
}

function publicationDestinationError(path: string, stats: Stats): Error {
  if (stats.isSymbolicLink()) {
    return new Error(`Unsafe symbolic link at publication destination: ${path}`);
  }
  return new Error(`Publication destination must be a regular file: ${path}`);
}

function removalTargetError(path: string, stats: Stats): Error {
  if (stats.isSymbolicLink()) {
    return new Error(`Unsafe symbolic link at safe removal target: ${path}`);
  }
  return new Error(`Safe removal target must be a regular file: ${path}`);
}

async function inspectRegularLeaf(
  path: string,
  errorFor: (path: string, stats: Stats) => Error,
): Promise<Stats | null> {
  const stats = await lstatIfExists(path);
  if (!stats) return null;
  if (!stats.isFile()) throw errorFor(path, stats);
  return stats;
}

function noFollowFlags(base: number): number {
  if (typeof constants.O_NOFOLLOW !== "number") {
    throw new Error("Safe local file publication requires O_NOFOLLOW support");
  }
  return base | constants.O_NOFOLLOW;
}

async function readRegularLeaf(path: string): Promise<Buffer | null> {
  const initial = await inspectRegularLeaf(path, publicationDestinationError);
  if (!initial) return null;

  let handle: FileHandle;
  try {
    handle = await open(path, noFollowFlags(constants.O_RDONLY));
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    if (hasCode(error, "ELOOP") || hasCode(error, "EMLINK")) {
      throw new Error(`Unsafe symbolic link at publication destination: ${path}`, { cause: error });
    }
    throw error;
  }

  let primaryError: CapturedError | null = null;
  let bytes: Buffer | undefined;
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw publicationDestinationError(path, stats);
    bytes = await handle.readFile();
  } catch (error) {
    primaryError = { value: error };
  }

  try {
    await handle.close();
  } catch (closeError) {
    if (primaryError !== null) {
      const primary = primaryError.value;
      primaryError = {
        value: new AggregateError(
          [primary, closeError],
          `${errorText(primary)}; leaf close failed: ${errorText(closeError)}`,
          { cause: primary },
        ),
      };
    } else {
      primaryError = { value: closeError };
    }
  }

  if (primaryError !== null) throw primaryError.value;
  return bytes!;
}

async function destinationMatches(path: string, bytes: Uint8Array): Promise<boolean> {
  const current = await readRegularLeaf(path);
  return current !== null && current.equals(Buffer.from(bytes));
}

function stageIdentity(stats: Stats): StageIdentity {
  return { device: stats.dev, inode: stats.ino };
}

async function inspectOwnedStage(path: string, identity: StageIdentity): Promise<boolean> {
  const stats = await lstatIfExists(path);
  if (!stats) return false;
  if (!stats.isFile() || stats.dev !== identity.device || stats.ino !== identity.inode) {
    throw new Error(`Publication stage changed after exclusive creation: ${path}`);
  }
  return true;
}

async function requireOwnedStage(path: string, identity: StageIdentity): Promise<void> {
  if (!await inspectOwnedStage(path, identity)) {
    throw new Error(`Publication stage disappeared after exclusive creation: ${path}`);
  }
}

async function createOwnedStage(
  stagePath: string,
  bytes: Uint8Array,
  openStage: NonNullable<PublicationDependencies["openStage"]>,
  removeStage: NonNullable<PublicationDependencies["removeStage"]>,
  revalidateBeforeRemoval: () => Promise<void>,
): Promise<StageIdentity> {
  let handle: StageHandle | undefined;
  let owned = false;
  let identity: StageIdentity | undefined;
  let primaryError: CapturedError | null = null;
  try {
    const flags = noFollowFlags(constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
    handle = await openStage(stagePath, flags, 0o666);
    owned = true;
    const stats = handle.stat ? await handle.stat() : await lstat(stagePath);
    if (!stats.isFile()) throw new Error(`Publication stage is not a regular file: ${stagePath}`);
    identity = stageIdentity(stats);
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    primaryError = { value: error };
  }

  if (handle) {
    try {
      await handle.close();
    } catch (closeError) {
      if (primaryError !== null) {
        const primary = primaryError.value;
        primaryError = {
          value: new AggregateError(
            [primary, closeError],
            `${errorText(primary)}; stage close failed: ${errorText(closeError)}`,
            { cause: primary },
          ),
        };
      } else {
        primaryError = { value: closeError };
      }
    }
  }

  if (primaryError !== null) {
    if (owned && identity) {
      try {
        await revalidateBeforeRemoval();
        if (await inspectOwnedStage(stagePath, identity)) await removeStage(stagePath);
      } catch (cleanupError) {
        throw errorWithCleanup(primaryError.value, cleanupError);
      }
    }
    throw primaryError.value;
  }
  return identity!;
}

async function removeOwnedStage(
  stagePath: string,
  removeStage: NonNullable<PublicationDependencies["removeStage"]>,
  primaryError: CapturedError | null,
  publicationCommitted: boolean,
  revalidateBeforeRemoval: () => Promise<void>,
  identity: StageIdentity,
): Promise<void> {
  try {
    await revalidateBeforeRemoval();
    if (await inspectOwnedStage(stagePath, identity)) await removeStage(stagePath);
  } catch (cleanupError) {
    if (primaryError !== null) throw errorWithCleanup(primaryError.value, cleanupError);
    // A hard-link publication is already visible. Report that success so an upstream transaction
    // can register rollback; the exclusively-created random stage is the only leaked entry.
    if (publicationCommitted) return;
    throw cleanupError;
  }
  if (primaryError !== null) throw primaryError.value;
}

async function createOnlyResultAfterCollision(
  destinationPath: string,
  bytes: Uint8Array,
): Promise<{ path: string; created: boolean }> {
  if (await destinationMatches(destinationPath, bytes)) {
    return { path: destinationPath, created: false };
  }
  const current = await inspectRegularLeaf(destinationPath, publicationDestinationError);
  if (!current) {
    throw new Error(`Create-only publication lost its destination before comparison: ${destinationPath}`);
  }
  throw new SafeFileConflictError(destinationPath);
}

/**
 * Publishes one complete sibling-staged file without following destination entries. A missing root
 * and its directory chain are created below the nearest existing canonical directory.
 *
 * This is a local-filesystem hardening boundary, not a claim of race-free directory handles:
 * Node does not expose openat/renameat-style directory-handle operations. Root, ancestor, stage
 * identity, and leaf-type revalidation immediately before mutation narrows, but cannot eliminate,
 * continuously malicious namespace swaps between the last check and link/rename/unlink. Leaf
 * operations act on directory entries and never follow a leaf symbolic link.
 *
 * Once a hard link commits the destination, a stage-cleanup failure does not turn that committed
 * publication into a rejection; the caller receives the result so it can register rollback, and
 * the exclusively-created hidden stage may remain for later cleanup.
 */
export function publishFileSafely(
  options: SafeFilePublication,
): Promise<{ path: string; created: boolean }>;
export async function publishFileSafely(
  options: SafeFilePublication,
  dependencies: PublicationDependencies = {},
): Promise<{ path: string; created: boolean }> {
  assertPortableRelativePath(options.relativePath);
  const boundary = await resolveOrCreateRootBoundary(options.root);
  const segments = options.relativePath.split("/");
  const destinationPath = join(boundary.canonicalRoot, ...segments);
  assertCanonicalContainment(boundary.canonicalRoot, destinationPath);
  const ancestors = await ensureAncestors(boundary, segments.slice(0, -1), true);
  if (!ancestors) throw new Error("Publication ancestor creation failed");

  const initialLeaf = await inspectRegularLeaf(destinationPath, publicationDestinationError);
  if (!options.replace && initialLeaf) {
    if (await destinationMatches(destinationPath, options.bytes)) {
      return { path: destinationPath, created: false };
    }
    throw new SafeFileConflictError(destinationPath);
  }

  await revalidateAncestors(boundary, ancestors);
  const randomId = dependencies.randomId ?? randomUUID;
  const stagePath = join(dirname(destinationPath), `.${basename(destinationPath)}.${randomId()}.tmp`);
  const openStage = dependencies.openStage ?? ((path, flags, mode) => open(path, flags, mode));
  const linkFile = dependencies.linkFile ?? link;
  const moveFile = dependencies.moveFile ?? rename;
  const removeStage = dependencies.removeStage ?? unlink;

  const revalidateStageAncestors = () => revalidateAncestors(boundary, ancestors);
  const identity = await createOwnedStage(
    stagePath,
    options.bytes,
    openStage,
    removeStage,
    revalidateStageAncestors,
  );
  let stageOwned = true;
  let publicationCommitted = false;
  let result: { path: string; created: boolean } | undefined;
  let primaryError: CapturedError | null = null;
  try {
    await dependencies.beforePublication?.({
      destinationPath,
      stagePath,
      mode: options.replace ? "replace" : "create-only",
    });
    await revalidateAncestors(boundary, ancestors);
    await requireOwnedStage(stagePath, identity);

    if (!options.replace) {
      try {
        await linkFile(stagePath, destinationPath);
        publicationCommitted = true;
        result = { path: destinationPath, created: true };
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
        result = await createOnlyResultAfterCollision(destinationPath, options.bytes);
      }
    } else {
      for (;;) {
        const currentLeaf = await inspectRegularLeaf(destinationPath, publicationDestinationError);
        if (!currentLeaf) {
          await revalidateAncestors(boundary, ancestors);
          await requireOwnedStage(stagePath, identity);
          try {
            await linkFile(stagePath, destinationPath);
            publicationCommitted = true;
            result = { path: destinationPath, created: true };
            break;
          } catch (error) {
            if (!hasCode(error, "EEXIST")) throw error;
            continue;
          }
        }

        await revalidateAncestors(boundary, ancestors);
        const recheckedLeaf = await inspectRegularLeaf(destinationPath, publicationDestinationError);
        if (!recheckedLeaf) continue;
        await requireOwnedStage(stagePath, identity);
        await moveFile(stagePath, destinationPath);
        stageOwned = false;
        publicationCommitted = true;
        result = { path: destinationPath, created: false };
        break;
      }
    }
  } catch (error) {
    primaryError = { value: error };
  }

  if (stageOwned) {
    await removeOwnedStage(
      stagePath,
      removeStage,
      primaryError,
      publicationCommitted,
      revalidateStageAncestors,
      identity,
    );
  } else if (primaryError !== null) {
    throw primaryError.value;
  }
  return result!;
}

/**
 * Removes a verified regular leaf without ever following a leaf symbolic link. It has the same
 * local-filesystem ancestor-race limitation documented by publishFileSafely.
 */
export async function removeRegularFileSafely(root: string, relativePath: string): Promise<boolean> {
  assertPortableRelativePath(relativePath);
  const boundary = await resolveRootBoundaryIfExists(root);
  if (!boundary) return false;
  const segments = relativePath.split("/");
  const destinationPath = join(boundary.canonicalRoot, ...segments);
  assertCanonicalContainment(boundary.canonicalRoot, destinationPath);
  const ancestors = await ensureAncestors(boundary, segments.slice(0, -1), false);
  if (!ancestors) return false;

  const initialLeaf = await inspectRegularLeaf(destinationPath, removalTargetError);
  if (!initialLeaf) return false;
  await revalidateAncestors(boundary, ancestors);
  const currentLeaf = await inspectRegularLeaf(destinationPath, removalTargetError);
  if (!currentLeaf) return false;
  try {
    await unlink(destinationPath);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
  return true;
}
