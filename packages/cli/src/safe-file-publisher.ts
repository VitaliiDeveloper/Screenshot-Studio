// SPDX-License-Identifier: Apache-2.0
import { createHash, randomUUID } from "node:crypto";
import { constants, type BigIntStats, type Stats } from "node:fs";
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

export interface SafeFileOwnership {
  device: bigint;
  inode: bigint;
  revision: string;
}

export interface SafeFilePublicationWithOwnership {
  path: string;
  created: boolean;
  ownership: SafeFileOwnership;
}

export interface SafeRegularFileQuarantine {
  path: string;
  recoveryPath: string;
  bytes: Uint8Array;
  ownership: SafeFileOwnership;
  restore(): Promise<void>;
  discard(): Promise<void>;
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
type VerificationHandle = Pick<FileHandle, "stat" | "readFile" | "close">;

type StageIdentity = SafeFileOwnership;

interface TrackedFileEvidence extends StageIdentity {
  links: bigint;
  bytes: Buffer;
}

interface PublicationDependencies {
  randomId?: () => string;
  openStage?: (path: string, flags: number, mode: number) => Promise<StageHandle>;
  openVerification?: (path: string, flags: number) => Promise<VerificationHandle>;
  linkFile?: (source: string, destination: string) => Promise<void>;
  moveFile?: (source: string, destination: string) => Promise<void>;
  quarantineFile?: (source: string, destination: string) => Promise<void>;
  restoreLink?: (source: string, destination: string) => Promise<void>;
  removeStage?: (path: string) => Promise<void>;
  captureOwnership?: (ownership: SafeFileOwnership) => void;
  beforePublication?: (context: {
    destinationPath: string;
    stagePath: string;
    mode: "create-only" | "replace";
  }) => Promise<void>;
}

interface RemovalDependencies {
  openVerification?: (path: string, flags: number) => Promise<VerificationHandle>;
  quarantineFile?: (source: string, destination: string) => Promise<void>;
  restoreLink?: (source: string, destination: string) => Promise<void>;
  removeFile?: (path: string) => Promise<void>;
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

interface QuarantineOutcome {
  captured: boolean;
  error: CapturedError | null;
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

async function lstatBigIntIfExists(path: string): Promise<BigIntStats | null> {
  try {
    return await lstat(path, { bigint: true });
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
  return base | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0);
}

function verificationFlags(): number {
  return noFollowFlags(constants.O_RDONLY)
    | (typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0);
}

async function readRegularLeaf(
  path: string,
  openVerification: NonNullable<PublicationDependencies["openVerification"]>,
): Promise<TrackedFileEvidence | null> {
  const initial = await inspectRegularLeaf(path, publicationDestinationError);
  if (!initial) return null;
  const evidence = await readBoundRegularFileEvidence(
    path,
    openVerification,
    "Publication destination changed during byte comparison",
    false,
  );
  return evidence;
}

async function destinationMatches(
  path: string,
  bytes: Uint8Array,
  openVerification: NonNullable<PublicationDependencies["openVerification"]>,
): Promise<TrackedFileEvidence | null> {
  const current = await readRegularLeaf(path, openVerification);
  return current !== null && current.bytes.equals(Buffer.from(bytes)) ? current : null;
}

function contentRevision(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function stageIdentity(stats: BigIntStats, bytes: Uint8Array): StageIdentity {
  return { device: stats.dev, inode: stats.ino, revision: contentRevision(bytes) };
}

function evidenceWithLinks(
  evidence: TrackedFileEvidence,
  links: bigint,
): TrackedFileEvidence {
  return { ...evidence, links };
}

function evidenceMatches(
  actual: TrackedFileEvidence,
  expected: TrackedFileEvidence,
): boolean {
  return actual.device === expected.device
    && actual.inode === expected.inode
    && actual.links === expected.links
    && actual.revision === expected.revision
    && actual.bytes.equals(expected.bytes);
}

function evidenceMatchesIdentityAndBytes(
  actual: TrackedFileEvidence,
  expected: TrackedFileEvidence,
): boolean {
  return actual.device === expected.device
    && actual.inode === expected.inode
    && actual.revision === expected.revision
    && actual.bytes.equals(expected.bytes);
}

function expectedEvidence(
  identity: StageIdentity,
  links: bigint,
  bytes: Uint8Array,
): TrackedFileEvidence {
  return { ...identity, links, bytes: Buffer.from(bytes) };
}

async function readBoundRegularFileEvidence(
  path: string,
  openVerification: NonNullable<PublicationDependencies["openVerification"]>,
  changedMessage: string,
  requireStableLinkCount = true,
): Promise<TrackedFileEvidence | null> {
  const initial = await lstatBigIntIfExists(path);
  if (!initial) return null;
  if (!initial.isFile()) throw new Error(`${changedMessage}: ${path}`);

  let handle: VerificationHandle;
  try {
    handle = await openVerification(path, verificationFlags());
  } catch (error) {
    throw new Error(`${changedMessage}: ${path}`, { cause: error });
  }

  let primaryError: CapturedError | null = null;
  let evidence: TrackedFileEvidence | null = null;
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile()) throw new Error(`${changedMessage}: ${path}`);
    const namedBeforeRead = await lstatBigIntIfExists(path);
    if (
      !namedBeforeRead?.isFile()
      || namedBeforeRead.dev !== opened.dev
      || namedBeforeRead.ino !== opened.ino
      || (requireStableLinkCount && namedBeforeRead.nlink !== opened.nlink)
    ) {
      throw new Error(`${changedMessage}: ${path}`);
    }
    const bytes = await handle.readFile();
    evidence = {
      device: opened.dev,
      inode: opened.ino,
      links: opened.nlink,
      revision: contentRevision(bytes),
      bytes,
    };
    const namedWhileOpen = await lstatBigIntIfExists(path);
    if (
      !namedWhileOpen?.isFile()
      || namedWhileOpen.dev !== evidence.device
      || namedWhileOpen.ino !== evidence.inode
      || (requireStableLinkCount && namedWhileOpen.nlink !== evidence.links)
    ) {
      throw new Error(`${changedMessage}: ${path}`);
    }
  } catch (error) {
    primaryError = { value: error };
  }

  try {
    await handle.close();
  } catch (closeError) {
    if (primaryError !== null) {
      primaryError = {
        value: new AggregateError(
          [primaryError.value, closeError],
          `${errorText(primaryError.value)}; publication verification close failed: ${errorText(closeError)}`,
          { cause: primaryError.value },
        ),
      };
    } else {
      primaryError = { value: closeError };
    }
  }

  if (primaryError !== null) throw primaryError.value;
  if (evidence === null) throw new Error(`${changedMessage}: ${path}`);

  const named = await lstatBigIntIfExists(path);
  if (
    !named?.isFile()
    || named.dev !== evidence.device
    || named.ino !== evidence.inode
    || (requireStableLinkCount && named.nlink !== evidence.links)
  ) {
    throw new Error(`${changedMessage}: ${path}`);
  }
  return evidence;
}

async function inspectOwnedPublicationFile(
  path: string,
  identity: StageIdentity,
  expectedLinkCount: bigint | undefined,
  changedMessage: string,
  openVerification: NonNullable<PublicationDependencies["openVerification"]>,
): Promise<boolean> {
  const evidence = await readBoundRegularFileEvidence(path, openVerification, changedMessage);
  if (!evidence) return false;
  if (
    evidence.device !== identity.device
    || evidence.inode !== identity.inode
    || (expectedLinkCount !== undefined && evidence.links !== expectedLinkCount)
    || evidence.revision !== identity.revision
  ) throw new Error(`${changedMessage}: ${path}`);
  return true;
}

async function inspectOwnedStage(
  path: string,
  identity: StageIdentity,
  expectedLinkCount: bigint | undefined,
  openVerification: NonNullable<PublicationDependencies["openVerification"]>,
): Promise<boolean> {
  return inspectOwnedPublicationFile(
    path,
    identity,
    expectedLinkCount,
    "Publication stage changed after exclusive creation",
    openVerification,
  );
}

async function requireCommittedDestination(
  destinationPath: string,
  identity: StageIdentity,
  expectedLinkCount: bigint,
  openVerification: NonNullable<PublicationDependencies["openVerification"]>,
): Promise<void> {
  await requireCommittedDestinationLinkRange(
    destinationPath,
    identity,
    expectedLinkCount,
    expectedLinkCount,
    openVerification,
  );
}

async function requireCommittedDestinationLinkRange(
  destinationPath: string,
  identity: StageIdentity,
  minimumLinkCount: bigint,
  maximumLinkCount: bigint,
  openVerification: NonNullable<PublicationDependencies["openVerification"]>,
): Promise<void> {
  const changedMessage = "Publication destination changed after committed hard-link publication";
  const evidence = await readBoundRegularFileEvidence(
    destinationPath,
    openVerification,
    changedMessage,
  );
  if (
    !evidence
    || evidence.device !== identity.device
    || evidence.inode !== identity.inode
    || evidence.revision !== identity.revision
    || evidence.links < minimumLinkCount
    || evidence.links > maximumLinkCount
  ) {
    throw new Error(`${changedMessage}: ${destinationPath}`);
  }
}

async function reconcileHardLinkPublication(
  stagePath: string,
  destinationPath: string,
  identity: StageIdentity,
  openVerification: NonNullable<PublicationDependencies["openVerification"]>,
): Promise<"stage-linked" | "destination-only" | null> {
  try {
    const destination = await readBoundRegularFileEvidence(
      destinationPath,
      openVerification,
      "Publication destination changed during hard-link reconciliation",
    );
    if (
      destination === null
      || destination.device !== identity.device
      || destination.inode !== identity.inode
      || destination.revision !== identity.revision
    ) return null;
    if (destination.links === 1n) return "destination-only";
    if (destination.links !== 2n) return null;
    const stage = await readBoundRegularFileEvidence(
      stagePath,
      openVerification,
      "Publication stage changed during hard-link reconciliation",
    );
    return stage !== null && evidenceMatches(stage, destination)
      ? "stage-linked"
      : null;
  } catch {
    return null;
  }
}

async function reconcileRenamePublication(
  destinationPath: string,
  identity: StageIdentity,
  openVerification: NonNullable<PublicationDependencies["openVerification"]>,
): Promise<boolean> {
  try {
    await requireCommittedDestination(destinationPath, identity, 1n, openVerification);
    return true;
  } catch {
    return false;
  }
}

async function quarantineEntry(
  sourcePath: string,
  quarantinePath: string,
  quarantineFile: NonNullable<PublicationDependencies["quarantineFile"]>,
  revalidateBeforeMutation: () => Promise<void>,
): Promise<QuarantineOutcome> {
  await revalidateBeforeMutation();
  const sourceBefore = await lstatBigIntIfExists(sourcePath);
  if (!sourceBefore) return { captured: false, error: null };
  let mutationError: CapturedError | null = null;
  try {
    await quarantineFile(sourcePath, quarantinePath);
  } catch (error) {
    mutationError = { value: error };
  }
  const [sourceAfter, quarantineAfter] = await Promise.all([
    lstatBigIntIfExists(sourcePath),
    lstatBigIntIfExists(quarantinePath),
  ]);
  const captured = quarantineAfter !== null;
  const sourceStillNamesCapturedEntry = sourceAfter !== null
    && sourceAfter.dev === sourceBefore.dev
    && sourceAfter.ino === sourceBefore.ino;
  if (mutationError === null && (!captured || sourceStillNamesCapturedEntry)) {
    mutationError = {
      value: new Error(`Publication quarantine mutation had an unexpected outcome: ${sourcePath}`),
    };
  }
  return { captured, error: mutationError };
}

function privateQuarantinePath(stagePath: string, purpose: string): string {
  return `${stagePath}.${randomUUID()}.${purpose}`;
}

async function recoveryEntryStatus(path: string): Promise<string> {
  return await lstatIfExists(path)
    ? `recovery retained at ${path}`
    : `recovery entry disappeared from ${path}`;
}

async function requireExactEvidence(
  path: string,
  expected: TrackedFileEvidence,
  changedMessage: string,
  openVerification: NonNullable<PublicationDependencies["openVerification"]>,
): Promise<void> {
  const actual = await readBoundRegularFileEvidence(path, openVerification, changedMessage);
  if (!actual || !evidenceMatches(actual, expected)) {
    throw new Error(`${changedMessage}: ${path}`);
  }
}

async function restoreQuarantinedEntryNoReplace(
  quarantinePath: string,
  destinationPath: string,
  evidence: TrackedFileEvidence,
  restoreLink: NonNullable<PublicationDependencies["restoreLink"]>,
  openVerification: NonNullable<PublicationDependencies["openVerification"]>,
  revalidateBeforeMutation: () => Promise<void>,
): Promise<void> {
  await revalidateBeforeMutation();
  if (await lstatIfExists(destinationPath)) {
    throw new Error(`Cannot restore publication recovery over an occupied path: ${destinationPath}`);
  }
  await restoreLink(quarantinePath, destinationPath);
  const linkedEvidence = evidenceWithLinks(evidence, evidence.links + 1n);
  await requireExactEvidence(
    quarantinePath,
    linkedEvidence,
    "Publication recovery changed",
    openVerification,
  );
  await requireExactEvidence(
    destinationPath,
    linkedEvidence,
    "Restored publication entry changed",
    openVerification,
  );
}

async function removeExactQuarantine(
  quarantinePath: string,
  expected: TrackedFileEvidence,
  removeStage: NonNullable<PublicationDependencies["removeStage"]>,
  openVerification: NonNullable<PublicationDependencies["openVerification"]>,
  revalidateBeforeMutation: () => Promise<void>,
): Promise<void> {
  await revalidateBeforeMutation();
  await requireExactEvidence(
    quarantinePath,
    expected,
    "Publication quarantine changed before cleanup",
    openVerification,
  );
  await removeStage(quarantinePath);
}

async function removeExactQuarantineReconciled(
  quarantinePath: string,
  expected: TrackedFileEvidence,
  removeStage: NonNullable<PublicationDependencies["removeStage"]>,
  openVerification: NonNullable<PublicationDependencies["openVerification"]>,
  revalidateBeforeMutation: () => Promise<void>,
): Promise<void> {
  try {
    await removeExactQuarantine(
      quarantinePath,
      expected,
      removeStage,
      openVerification,
      revalidateBeforeMutation,
    );
  } catch (error) {
    if (!await lstatIfExists(quarantinePath)) return;
    throw new Error(`${errorText(error)}; ${await recoveryEntryStatus(quarantinePath)}`, {
      cause: error,
    });
  }
}

async function requireOwnedStage(
  path: string,
  identity: StageIdentity,
  openVerification: NonNullable<PublicationDependencies["openVerification"]>,
): Promise<void> {
  if (!await inspectOwnedStage(path, identity, 1n, openVerification)) {
    throw new Error(`Publication stage disappeared after exclusive creation: ${path}`);
  }
}

async function cleanupFailedOwnedStage(
  stagePath: string,
  identity: StageIdentity,
  removeStage: NonNullable<PublicationDependencies["removeStage"]>,
  quarantineFile: NonNullable<PublicationDependencies["quarantineFile"]>,
  restoreLink: NonNullable<PublicationDependencies["restoreLink"]>,
  openVerification: NonNullable<PublicationDependencies["openVerification"]>,
  revalidateBeforeRemoval: () => Promise<void>,
): Promise<void> {
  const quarantinePath = privateQuarantinePath(stagePath, "creation-quarantine");
  const quarantine = await quarantineEntry(
    stagePath,
    quarantinePath,
    quarantineFile,
    revalidateBeforeRemoval,
  );
  if (!quarantine.captured) {
    if (quarantine.error !== null) throw quarantine.error.value;
    return;
  }

  let evidence: TrackedFileEvidence | null;
  try {
    evidence = await readBoundRegularFileEvidence(
      quarantinePath,
      openVerification,
      "Failed publication stage changed during cleanup quarantine",
    );
  } catch (verificationError) {
    throw new Error(`Failed publication stage ${await recoveryEntryStatus(quarantinePath)}`, {
      cause: verificationError,
    });
  }

  if (
    quarantine.error === null
    &&
    evidence
    && evidence.device === identity.device
    && evidence.inode === identity.inode
  ) {
    await removeExactQuarantineReconciled(
      quarantinePath,
      evidence,
      removeStage,
      openVerification,
      revalidateBeforeRemoval,
    );
    return;
  }

  const recoveryErrors: unknown[] = [];
  if (evidence) {
    try {
      await restoreQuarantinedEntryNoReplace(
        quarantinePath,
        stagePath,
        evidence,
        restoreLink,
        openVerification,
        revalidateBeforeRemoval,
      );
    } catch (recoveryError) {
      recoveryErrors.push(recoveryError);
    }
  }
  const recoveryStatus = await recoveryEntryStatus(quarantinePath);
  throw new AggregateError(
    [
      quarantine.error !== null
        ? quarantine.error.value
        : new Error(`Failed publication stage was replaced before cleanup: ${stagePath}`),
      ...recoveryErrors,
    ],
    `Failed publication stage cleanup failed; ${recoveryStatus}`,
  );
}

async function createOwnedStage(
  stagePath: string,
  bytes: Uint8Array,
  openStage: NonNullable<PublicationDependencies["openStage"]>,
  removeStage: NonNullable<PublicationDependencies["removeStage"]>,
  quarantineFile: NonNullable<PublicationDependencies["quarantineFile"]>,
  restoreLink: NonNullable<PublicationDependencies["restoreLink"]>,
  openVerification: NonNullable<PublicationDependencies["openVerification"]>,
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
    const stats = handle.stat
      ? await handle.stat({ bigint: true })
      : await lstat(stagePath, { bigint: true });
    if (!stats.isFile()) throw new Error(`Publication stage is not a regular file: ${stagePath}`);
    identity = stageIdentity(stats, bytes);
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
        await cleanupFailedOwnedStage(
          stagePath,
          identity,
          removeStage,
          quarantineFile,
          restoreLink,
          openVerification,
          revalidateBeforeRemoval,
        );
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
  destinationPath: string,
  removeStage: NonNullable<PublicationDependencies["removeStage"]>,
  primaryError: CapturedError | null,
  publicationCommitted: boolean,
  revalidateBeforeRemoval: () => Promise<void>,
  identity: StageIdentity,
  publicationBytes: Uint8Array,
  quarantineFile: NonNullable<PublicationDependencies["quarantineFile"]>,
  restoreLink: NonNullable<PublicationDependencies["restoreLink"]>,
  openVerification: NonNullable<PublicationDependencies["openVerification"]>,
): Promise<void> {
  const stageQuarantinePath = privateQuarantinePath(stagePath, "quarantine");
  const destinationQuarantinePath = privateQuarantinePath(stagePath, "destination-quarantine");
  let stageCaptured = false;
  let stageEvidence: TrackedFileEvidence | null = null;
  let uncapturedStageEvidence: TrackedFileEvidence | null = null;
  let stageInspectionError: CapturedError | null;

  try {
    const stageQuarantine = await quarantineEntry(
      stagePath,
      stageQuarantinePath,
      quarantineFile,
      revalidateBeforeRemoval,
    );
    stageCaptured = stageQuarantine.captured;
    stageInspectionError = stageQuarantine.error;
    if (stageCaptured) {
      stageEvidence = await readBoundRegularFileEvidence(
        stageQuarantinePath,
        openVerification,
        "Publication stage changed during cleanup quarantine",
      );
    }
  } catch (error) {
    stageInspectionError = { value: error };
  }

  if (publicationCommitted && !stageCaptured && stageInspectionError !== null) {
    try {
      uncapturedStageEvidence = await readBoundRegularFileEvidence(
        stagePath,
        openVerification,
        "Publication stage changed after failed cleanup quarantine",
      );
    } catch (error) {
      stageInspectionError = {
        value: new AggregateError(
          [stageInspectionError.value, error],
          `${errorText(stageInspectionError.value)}; publication stage reconciliation failed: ${errorText(error)}`,
          { cause: stageInspectionError.value },
        ),
      };
    }
  }

  if (!publicationCommitted) {
    if (!stageCaptured) {
      if (stageInspectionError !== null && primaryError !== null) {
        throw errorWithCleanup(primaryError.value, stageInspectionError.value);
      }
      if (stageInspectionError !== null) throw stageInspectionError.value;
      if (primaryError !== null) throw primaryError.value;
      return;
    }

    const expectedStage = expectedEvidence(identity, 1n, publicationBytes);
    if (
      stageInspectionError !== null
      || stageEvidence === null
      || !evidenceMatches(stageEvidence, expectedStage)
    ) {
      const recoveryErrors: unknown[] = [];
      if (stageEvidence !== null) {
        try {
          await restoreQuarantinedEntryNoReplace(
            stageQuarantinePath,
            stagePath,
            stageEvidence,
            restoreLink,
            openVerification,
            revalidateBeforeRemoval,
          );
        } catch (recoveryError) {
          recoveryErrors.push(recoveryError);
        }
      }
      const capturedStageError = stageInspectionError !== null
        ? stageInspectionError.value
        : new Error(`Publication stage changed before cleanup: ${stageQuarantinePath}`);
      const recoveryStatus = await recoveryEntryStatus(stageQuarantinePath);
      const cleanupError = new AggregateError(
        [
          capturedStageError,
          ...recoveryErrors,
        ],
        `Publication stage cleanup failed; ${recoveryStatus}`,
        { cause: stageInspectionError !== null ? stageInspectionError.value : undefined },
      );
      if (primaryError !== null) throw errorWithCleanup(primaryError.value, cleanupError);
      throw cleanupError;
    }

    try {
      await removeExactQuarantineReconciled(
        stageQuarantinePath,
        expectedStage,
        removeStage,
        openVerification,
        revalidateBeforeRemoval,
      );
    } catch (cleanupError) {
      if (primaryError !== null) throw errorWithCleanup(primaryError.value, cleanupError);
      throw cleanupError;
    }
    if (primaryError !== null) throw primaryError.value;
    return;
  }

  const expectedLinkedStage = expectedEvidence(identity, 2n, publicationBytes);
  const uncapturedStageIsExpected = uncapturedStageEvidence !== null
    && evidenceMatches(uncapturedStageEvidence, expectedLinkedStage);
  let expectedDestination = expectedEvidence(
    identity,
    stageCaptured || uncapturedStageIsExpected ? 2n : 1n,
    publicationBytes,
  );
  const stageHasExpectedIdentityAndBytes = stageCaptured
    && stageEvidence !== null
    && evidenceMatchesIdentityAndBytes(stageEvidence, expectedLinkedStage);
  let destinationVerificationError: CapturedError | null = null;
  try {
    const destinationEvidence = await readBoundRegularFileEvidence(
      destinationPath,
      openVerification,
      "Publication destination changed after committed hard-link publication",
    );
    if (
      destinationEvidence === null
      || !evidenceMatchesIdentityAndBytes(destinationEvidence, expectedDestination)
      || destinationEvidence.links < 1n
      || destinationEvidence.links > 2n
      || (stageHasExpectedIdentityAndBytes && (
        stageEvidence?.links !== 2n || destinationEvidence.links !== 2n
      ))
      || (uncapturedStageIsExpected && destinationEvidence.links !== 2n)
      || (
        !stageHasExpectedIdentityAndBytes
        && !uncapturedStageIsExpected
        && destinationEvidence.links !== 1n
      )
    ) {
      throw new Error(
        `Publication destination changed after committed hard-link publication: ${destinationPath}`,
      );
    }
    expectedDestination = evidenceWithLinks(expectedDestination, destinationEvidence.links);
  } catch (error) {
    destinationVerificationError = { value: error };
  }

  const stageIsExpected = stageCaptured
    && stageEvidence !== null
    && evidenceMatches(stageEvidence, expectedLinkedStage);
  let exactStageRemoved = false;

  if (destinationVerificationError === null) {
    if (uncapturedStageIsExpected) return;
    if (!stageCaptured) return;
    if (!stageIsExpected) {
      let recoveryError: CapturedError | null = null;
      if (stageEvidence !== null) {
        try {
          await restoreQuarantinedEntryNoReplace(
            stageQuarantinePath,
            stagePath,
            stageEvidence,
            restoreLink,
            openVerification,
            revalidateBeforeRemoval,
          );
        } catch (error) {
          recoveryError = { value: error };
        }
      }
      try {
        await requireCommittedDestinationLinkRange(
          destinationPath,
          identity,
          1n,
          2n,
          openVerification,
        );
        return;
      } catch (error) {
        destinationVerificationError = {
          value: recoveryError === null
            ? error
            : new AggregateError(
              [error, recoveryError.value],
              `${errorText(error)}; publication stage recovery failed: ${errorText(recoveryError.value)}`,
              { cause: error },
            ),
        };
      }
    } else {
      let cleanupError: CapturedError | null = null;
      try {
        await removeExactQuarantine(
          stageQuarantinePath,
          expectedLinkedStage,
          removeStage,
          openVerification,
          revalidateBeforeRemoval,
        );
        exactStageRemoved = true;
        expectedDestination = evidenceWithLinks(expectedDestination, 1n);
      } catch (error) {
        cleanupError = { value: error };
        exactStageRemoved = await lstatIfExists(stageQuarantinePath) === null;
        if (exactStageRemoved) {
          expectedDestination = evidenceWithLinks(expectedDestination, 1n);
        }
      }

      try {
        if (cleanupError === null) {
          await requireCommittedDestination(destinationPath, identity, 1n, openVerification);
        } else {
          await requireCommittedDestinationLinkRange(
            destinationPath,
            identity,
            1n,
            2n,
            openVerification,
          );
        }
        return;
      } catch (error) {
        destinationVerificationError = {
          value: cleanupError === null
            ? error
            : new AggregateError(
              [error, cleanupError.value],
              `${errorText(error)}; publication stage cleanup failed: ${errorText(cleanupError.value)}`,
              { cause: error },
            ),
        };
      }
    }
  }

  if (destinationVerificationError === null) {
    throw new Error("Committed publication rollback requires a captured verification failure");
  }
  const destinationError = destinationVerificationError.value;

  const rollbackErrors: unknown[] = [];
  const recoveryPaths: string[] = [];
  let destinationCaptured = false;
  let exactDestinationRemoved = false;
  try {
    const destinationQuarantine = await quarantineEntry(
      destinationPath,
      destinationQuarantinePath,
      quarantineFile,
      revalidateBeforeRemoval,
    );
    destinationCaptured = destinationQuarantine.captured;
    if (destinationCaptured) {
      const quarantinedDestination = await readBoundRegularFileEvidence(
        destinationQuarantinePath,
        openVerification,
        "Committed publication destination changed during rollback quarantine",
      );
      if (quarantinedDestination && evidenceMatches(quarantinedDestination, expectedDestination)) {
        try {
          await removeExactQuarantine(
            destinationQuarantinePath,
            expectedDestination,
            removeStage,
            openVerification,
            revalidateBeforeRemoval,
          );
          exactDestinationRemoved = true;
        } catch (removalError) {
          exactDestinationRemoved = await lstatIfExists(destinationQuarantinePath) === null;
          rollbackErrors.push(removalError);
          if (!exactDestinationRemoved) recoveryPaths.push(destinationQuarantinePath);
        }
      } else {
        if (quarantinedDestination) {
          try {
            await restoreQuarantinedEntryNoReplace(
              destinationQuarantinePath,
              destinationPath,
              quarantinedDestination,
              restoreLink,
              openVerification,
              revalidateBeforeRemoval,
            );
          } catch (recoveryError) {
            rollbackErrors.push(recoveryError);
          }
        }
        const recoveryStatus = await recoveryEntryStatus(destinationQuarantinePath);
        if (await lstatIfExists(destinationQuarantinePath)) {
          recoveryPaths.push(destinationQuarantinePath);
        }
        rollbackErrors.push(new Error(
          `Committed publication destination was not owned exactly; ${recoveryStatus}`,
        ));
      }
    }
    if (destinationQuarantine.error !== null) {
      rollbackErrors.push(destinationQuarantine.error.value);
    }
  } catch (rollbackError) {
    rollbackErrors.push(rollbackError);
    if (destinationCaptured && await lstatIfExists(destinationQuarantinePath)) {
      recoveryPaths.push(destinationQuarantinePath);
    }
  }

  if (stageCaptured && !exactStageRemoved) {
    if (stageIsExpected) {
      const rollbackStageEvidence = exactDestinationRemoved
        ? evidenceWithLinks(expectedLinkedStage, expectedLinkedStage.links - 1n)
        : expectedLinkedStage;
      try {
        await removeExactQuarantine(
          stageQuarantinePath,
          rollbackStageEvidence,
          removeStage,
          openVerification,
          revalidateBeforeRemoval,
        );
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
        if (await lstatIfExists(stageQuarantinePath)) recoveryPaths.push(stageQuarantinePath);
      }
    } else {
      if (stageEvidence !== null) {
        try {
          await restoreQuarantinedEntryNoReplace(
            stageQuarantinePath,
            stagePath,
            stageEvidence,
            restoreLink,
            openVerification,
            revalidateBeforeRemoval,
          );
        } catch (recoveryError) {
          rollbackErrors.push(recoveryError);
        }
      }
      const recoveryStatus = await recoveryEntryStatus(stageQuarantinePath);
      if (await lstatIfExists(stageQuarantinePath)) recoveryPaths.push(stageQuarantinePath);
      rollbackErrors.push(stageInspectionError !== null
        ? stageInspectionError.value
        : new Error(
          `Publication stage was not owned exactly; ${recoveryStatus}`,
        ));
    }
  }

  if (rollbackErrors.length > 0) {
    const recoverySuffix = recoveryPaths.length > 0
      ? `; recovery retained at ${[...new Set(recoveryPaths)].join(", ")}`
      : "";
    const rollbackDetail = rollbackErrors.map(errorText).join("; ");
    throw new AggregateError(
      [destinationError, ...rollbackErrors],
      `${errorText(destinationError)}; committed publication integrity rollback failed: ${rollbackDetail}${recoverySuffix}`,
      { cause: destinationError },
    );
  }
  throw destinationError;
}

async function createOnlyResultAfterCollision(
  destinationPath: string,
  bytes: Uint8Array,
  openVerification: NonNullable<PublicationDependencies["openVerification"]>,
): Promise<{ path: string; created: boolean; ownership: SafeFileOwnership }> {
  const existing = await destinationMatches(destinationPath, bytes, openVerification);
  if (existing) {
    return {
      path: destinationPath,
      created: false,
      ownership: {
        device: existing.device,
        inode: existing.inode,
        revision: existing.revision,
      },
    };
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
  const openVerification = dependencies.openVerification ?? ((path, flags) => open(path, flags));

  const initialLeaf = await inspectRegularLeaf(destinationPath, publicationDestinationError);
  if (!options.replace && initialLeaf) {
    const existing = await destinationMatches(destinationPath, options.bytes, openVerification);
    if (existing) {
      dependencies.captureOwnership?.({
        device: existing.device,
        inode: existing.inode,
        revision: existing.revision,
      });
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
  const quarantineFile = dependencies.quarantineFile ?? rename;
  const restoreLink = dependencies.restoreLink ?? link;
  const removeStage = dependencies.removeStage ?? unlink;

  const revalidateStageAncestors = () => revalidateAncestors(boundary, ancestors);
  const identity = await createOwnedStage(
    stagePath,
    options.bytes,
    openStage,
    removeStage,
    quarantineFile,
    restoreLink,
    openVerification,
    revalidateStageAncestors,
  );
  let stageOwned = true;
  let publicationCommitted = false;
  let result: { path: string; created: boolean } | undefined;
  let resultOwnership: SafeFileOwnership = identity;
  let primaryError: CapturedError | null = null;
  try {
    await dependencies.beforePublication?.({
      destinationPath,
      stagePath,
      mode: options.replace ? "replace" : "create-only",
    });
    await revalidateAncestors(boundary, ancestors);
    await requireOwnedStage(stagePath, identity, openVerification);

    if (!options.replace) {
      try {
        await linkFile(stagePath, destinationPath);
        publicationCommitted = true;
        result = { path: destinationPath, created: true };
      } catch (error) {
        const reconciled = await reconcileHardLinkPublication(
          stagePath,
          destinationPath,
          identity,
          openVerification,
        );
        if (reconciled !== null) {
          stageOwned = reconciled === "stage-linked";
          publicationCommitted = true;
          result = { path: destinationPath, created: true };
        } else {
          if (!hasCode(error, "EEXIST")) throw error;
          const collision = await createOnlyResultAfterCollision(
            destinationPath,
            options.bytes,
            openVerification,
          );
          result = { path: collision.path, created: collision.created };
          resultOwnership = collision.ownership;
        }
      }
    } else {
      for (;;) {
        const currentLeaf = await inspectRegularLeaf(destinationPath, publicationDestinationError);
        if (!currentLeaf) {
          await revalidateAncestors(boundary, ancestors);
          await requireOwnedStage(stagePath, identity, openVerification);
          try {
            await linkFile(stagePath, destinationPath);
            publicationCommitted = true;
            result = { path: destinationPath, created: true };
            break;
          } catch (error) {
            const reconciled = await reconcileHardLinkPublication(
              stagePath,
              destinationPath,
              identity,
              openVerification,
            );
            if (reconciled !== null) {
              stageOwned = reconciled === "stage-linked";
              publicationCommitted = true;
              result = { path: destinationPath, created: true };
              break;
            }
            if (!hasCode(error, "EEXIST")) throw error;
            continue;
          }
        }

        await revalidateAncestors(boundary, ancestors);
        const recheckedLeaf = await inspectRegularLeaf(destinationPath, publicationDestinationError);
        if (!recheckedLeaf) continue;
        await requireOwnedStage(stagePath, identity, openVerification);
        try {
          await moveFile(stagePath, destinationPath);
        } catch (error) {
          if (!await reconcileRenamePublication(
            destinationPath,
            identity,
            openVerification,
          )) throw error;
        }
        stageOwned = false;
        publicationCommitted = true;
        result = { path: destinationPath, created: false };
        await requireCommittedDestination(destinationPath, identity, 1n, openVerification);
        break;
      }
    }
  } catch (error) {
    primaryError = { value: error };
  }

  if (stageOwned) {
    await removeOwnedStage(
      stagePath,
      destinationPath,
      removeStage,
      primaryError,
      publicationCommitted,
      revalidateStageAncestors,
      identity,
      options.bytes,
      quarantineFile,
      restoreLink,
      openVerification,
    );
  } else if (primaryError !== null) {
    throw primaryError.value;
  }
  dependencies.captureOwnership?.(resultOwnership);
  return result!;
}

export async function publishFileSafelyWithOwnership(
  options: SafeFilePublication,
): Promise<SafeFilePublicationWithOwnership> {
  let ownership: SafeFileOwnership | undefined;
  const publishWithDependencies = publishFileSafely as unknown as (
    publication: SafeFilePublication,
    dependencies: PublicationDependencies,
  ) => Promise<{ path: string; created: boolean }>;
  const result = await publishWithDependencies(options, {
    captureOwnership: (captured) => {
      ownership = captured;
    },
  });
  if (!ownership) throw new Error("Safe file publication completed without ownership evidence");
  return { ...result, ownership };
}

function ownershipFromEvidence(evidence: TrackedFileEvidence): SafeFileOwnership {
  return {
    device: evidence.device,
    inode: evidence.inode,
    revision: evidence.revision,
  };
}

function ownershipMatchesEvidence(
  ownership: SafeFileOwnership,
  evidence: TrackedFileEvidence,
): boolean {
  return ownership.device === evidence.device
    && ownership.inode === evidence.inode
    && ownership.revision === evidence.revision;
}

/**
 * Atomically moves the current regular leaf to a private sibling path, then returns the bytes and
 * ownership evidence read from that exact quarantined entry. The returned capability must be
 * restored on transaction rollback or discarded on commit. Restore never replaces an occupant.
 *
 * This has the same local-filesystem directory-entry race limitation documented by
 * publishFileSafely; leaf inspection and reads never follow symbolic links or non-regular files.
 */
export function quarantineRegularFileSafely(
  root: string,
  relativePath: string,
  expectedOwnership?: SafeFileOwnership,
): Promise<SafeRegularFileQuarantine | null>;
export async function quarantineRegularFileSafely(
  root: string,
  relativePath: string,
  expectedOwnership?: SafeFileOwnership,
  dependencies: RemovalDependencies = {},
): Promise<SafeRegularFileQuarantine | null> {
  assertPortableRelativePath(relativePath);
  const boundary = await resolveRootBoundaryIfExists(root);
  if (!boundary) return null;
  const segments = relativePath.split("/");
  const destinationPath = join(boundary.canonicalRoot, ...segments);
  assertCanonicalContainment(boundary.canonicalRoot, destinationPath);
  const ancestors = await ensureAncestors(boundary, segments.slice(0, -1), false);
  if (!ancestors) return null;

  const initialLeaf = await inspectRegularLeaf(destinationPath, removalTargetError);
  if (!initialLeaf) return null;
  const openVerification = dependencies.openVerification ?? ((path, flags) => open(path, flags));
  let initialEvidence: TrackedFileEvidence | null = null;
  if (expectedOwnership) {
    initialEvidence = await readBoundRegularFileEvidence(
      destinationPath,
      openVerification,
      "Safe quarantine target changed during ownership capture",
    );
    if (!initialEvidence || !ownershipMatchesEvidence(expectedOwnership, initialEvidence)) return null;
  }

  const revalidateMutationBoundary = () => revalidateAncestors(boundary, ancestors);
  const recoveryPath = privateQuarantinePath(destinationPath, "transaction-quarantine");
  const quarantine = await quarantineEntry(
    destinationPath,
    recoveryPath,
    dependencies.quarantineFile ?? rename,
    revalidateMutationBoundary,
  );
  if (!quarantine.captured) {
    if (quarantine.error !== null) throw quarantine.error.value;
    return null;
  }

  let evidence: TrackedFileEvidence;
  try {
    const captured = await readBoundRegularFileEvidence(
      recoveryPath,
      openVerification,
      "Safe quarantine entry changed during bound byte capture",
    );
    if (!captured) throw new Error(`Safe quarantine entry disappeared: ${recoveryPath}`);
    evidence = captured;
  } catch (error) {
    throw new Error(`Safe quarantine failed; ${await recoveryEntryStatus(recoveryPath)}`, {
      cause: error,
    });
  }

  const sourceAfterQuarantine = await lstatBigIntIfExists(destinationPath);
  if (sourceAfterQuarantine !== null) {
    const mutationError = quarantine.error?.value
      ?? new Error(`Safe quarantine mutation left an occupied source path: ${destinationPath}`);
    throw new Error(`${errorText(mutationError)}; ${await recoveryEntryStatus(recoveryPath)}`, {
      cause: mutationError,
    });
  }

  let lifecycle: "active" | "restored" | "discarded" = "active";
  let restoreMutationAttempted = false;
  const linkedEvidence = evidenceWithLinks(evidence, evidence.links + 1n);
  const restoreLink = dependencies.restoreLink ?? link;
  const removeFile = dependencies.removeFile ?? unlink;

  const requireActive = (): void => {
    if (lifecycle !== "active") {
      throw new Error(`Safe quarantine capability is already ${lifecycle}`);
    }
  };

  type RestoreState = "quarantined" | "linked" | "cleaned" | "occupied";
  const reconcileRestoreState = async (): Promise<RestoreState> => {
    const quarantined = await readBoundRegularFileEvidence(
      recoveryPath,
      openVerification,
      "Safe quarantine changed during restore reconciliation",
    );
    const destinationStats = await lstatBigIntIfExists(destinationPath);

    if (quarantined !== null && evidenceMatches(quarantined, evidence)) {
      return destinationStats === null ? "quarantined" : "occupied";
    }

    if (quarantined !== null && evidenceMatches(quarantined, linkedEvidence)) {
      if (!destinationStats?.isFile()) return "occupied";
      const destination = await readBoundRegularFileEvidence(
        destinationPath,
        openVerification,
        "Restored safe quarantine entry changed during reconciliation",
      );
      if (destination !== null && evidenceMatches(destination, linkedEvidence)) return "linked";
      return "occupied";
    }

    if (quarantined === null && destinationStats?.isFile()) {
      const destination = await readBoundRegularFileEvidence(
        destinationPath,
        openVerification,
        "Restored safe quarantine entry changed after cleanup reconciliation",
      );
      if (destination !== null && evidenceMatches(destination, evidence)) return "cleaned";
    }

    throw new Error(`Safe quarantine restore state changed unexpectedly: ${recoveryPath}`);
  };

  const restoreError = async (error: unknown): Promise<Error> => new Error(
    `${errorText(error)}; ${await recoveryEntryStatus(recoveryPath)}`,
    { cause: error },
  );

  const restore = async (): Promise<void> => {
    requireActive();
    let state: RestoreState;
    try {
      state = await reconcileRestoreState();
    } catch (error) {
      throw await restoreError(error);
    }

    if (state === "cleaned") {
      lifecycle = "restored";
      return;
    }
    if (state === "occupied") {
      throw await restoreError(
        new Error(`Cannot restore publication recovery over an occupied path: ${destinationPath}`),
      );
    }

    if (state === "quarantined") {
      await revalidateMutationBoundary();
      await requireExactEvidence(
        recoveryPath,
        evidence,
        "Safe quarantine changed before restore",
        openVerification,
      );
      if (await lstatIfExists(destinationPath)) {
        throw await restoreError(
          new Error(`Cannot restore publication recovery over an occupied path: ${destinationPath}`),
        );
      }

      let linkError: CapturedError | null = null;
      restoreMutationAttempted = true;
      try {
        await restoreLink(recoveryPath, destinationPath);
      } catch (error) {
        linkError = { value: error };
      }

      try {
        state = await reconcileRestoreState();
      } catch (error) {
        if (linkError === null) throw await restoreError(error);
        throw await restoreError(new AggregateError(
          [linkError.value, error],
          `${errorText(linkError.value)}; safe quarantine restore was not committed exactly: ${errorText(error)}`,
          { cause: linkError.value },
        ));
      }
      if (state === "quarantined") {
        if (linkError !== null) throw await restoreError(linkError.value);
        throw await restoreError(new Error("Safe quarantine restore link had no effect"));
      }
      if (state === "occupied") {
        throw await restoreError(
          linkError?.value
            ?? new Error(`Safe quarantine restore produced an occupied path: ${destinationPath}`),
        );
      }
      if (state === "cleaned") {
        lifecycle = "restored";
        return;
      }
    }

    try {
      await requireExactEvidence(
        destinationPath,
        linkedEvidence,
        "Restored safe quarantine entry changed before cleanup",
        openVerification,
      );
      await removeExactQuarantine(
        recoveryPath,
        linkedEvidence,
        removeFile,
        openVerification,
        revalidateMutationBoundary,
      );
    } catch (error) {
      try {
        state = await reconcileRestoreState();
      } catch (reconciliationError) {
        throw await restoreError(new AggregateError(
          [error, reconciliationError],
          `${errorText(error)}; safe quarantine cleanup reconciliation failed: ${errorText(reconciliationError)}`,
          { cause: error },
        ));
      }
      if (state !== "cleaned") throw await restoreError(error);
    }

    try {
      state = await reconcileRestoreState();
    } catch (error) {
      throw await restoreError(error);
    }
    if (state !== "cleaned") {
      throw await restoreError(new Error("Safe quarantine restore cleanup did not commit exactly"));
    }
    lifecycle = "restored";
  };

  const discard = async (): Promise<void> => {
    requireActive();
    if (restoreMutationAttempted) {
      throw new Error("Cannot discard a safe quarantine after restore has committed");
    }
    try {
      await removeExactQuarantine(
        recoveryPath,
        evidence,
        removeFile,
        openVerification,
        revalidateMutationBoundary,
      );
    } catch (error) {
      if (await lstatIfExists(recoveryPath)) {
        throw new Error(`${errorText(error)}; ${await recoveryEntryStatus(recoveryPath)}`, {
          cause: error,
        });
      }
    }
    lifecycle = "discarded";
  };

  const capability: SafeRegularFileQuarantine = {
    path: destinationPath,
    recoveryPath,
    bytes: Uint8Array.from(evidence.bytes),
    ownership: ownershipFromEvidence(evidence),
    restore,
    discard,
  };

  if (
    expectedOwnership
    && (
      !ownershipMatchesEvidence(expectedOwnership, evidence)
      || (initialEvidence !== null && !evidenceMatches(evidence, initialEvidence))
    )
  ) {
    await capability.restore();
    return null;
  }

  return capability;
}

/**
 * Removes a verified regular leaf without ever following a leaf symbolic link. It has the same
 * local-filesystem ancestor-race limitation documented by publishFileSafely.
 */
export async function removeRegularFileSafely(
  root: string,
  relativePath: string,
  expectedOwnership?: SafeFileOwnership,
  dependencies: RemovalDependencies = {},
): Promise<boolean> {
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
  const openVerification = dependencies.openVerification ?? ((path, flags) => open(path, flags));
  const initialEvidence = await readBoundRegularFileEvidence(
    destinationPath,
    openVerification,
    "Safe removal target changed during ownership capture",
  );
  if (!initialEvidence) return false;
  if (
    expectedOwnership
    && (
      initialEvidence.device !== expectedOwnership.device
      || initialEvidence.inode !== expectedOwnership.inode
      || initialEvidence.revision !== expectedOwnership.revision
    )
  ) return false;

  const quarantinePath = privateQuarantinePath(destinationPath, "removal-quarantine");
  const quarantine = await quarantineEntry(
    destinationPath,
    quarantinePath,
    dependencies.quarantineFile ?? rename,
    () => revalidateAncestors(boundary, ancestors),
  );
  if (!quarantine.captured) {
    if (quarantine.error !== null) throw quarantine.error.value;
    return false;
  }

  let quarantinedEvidence: TrackedFileEvidence;
  try {
    const inspected = await readBoundRegularFileEvidence(
      quarantinePath,
      openVerification,
      "Safe removal quarantine changed before deletion",
    );
    if (!inspected) throw new Error(`Safe removal quarantine disappeared: ${quarantinePath}`);
    quarantinedEvidence = inspected;
  } catch (error) {
    throw new Error(`Safe removal failed; ${await recoveryEntryStatus(quarantinePath)}`, {
      cause: error,
    });
  }

  if (!evidenceMatches(quarantinedEvidence, initialEvidence)) {
    try {
      await restoreQuarantinedEntryNoReplace(
        quarantinePath,
        destinationPath,
        quarantinedEvidence,
        dependencies.restoreLink ?? link,
        openVerification,
        () => revalidateAncestors(boundary, ancestors),
      );
    } catch (error) {
      throw new Error(`Safe removal target changed; ${await recoveryEntryStatus(quarantinePath)}`, {
        cause: error,
      });
    }
    return false;
  }

  try {
    await removeExactQuarantine(
      quarantinePath,
      initialEvidence,
      dependencies.removeFile ?? unlink,
      openVerification,
      () => revalidateAncestors(boundary, ancestors),
    );
  } catch (error) {
    if (!await lstatIfExists(quarantinePath)) return true;
    throw new Error(`${errorText(error)}; ${await recoveryEntryStatus(quarantinePath)}`, {
      cause: error,
    });
  }
  return true;
}
