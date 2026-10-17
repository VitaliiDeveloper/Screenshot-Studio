// SPDX-License-Identifier: Apache-2.0
import { constants, type BigIntStats, type Stats } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import JSZip from "jszip";
import type { BundleEntry } from "@screenshot-studio/core/export";
import { isProjectRelativePath } from "@screenshot-studio/core/model";
import { noFollowFlags } from "@screenshot-studio/core/storage";

export interface RenderedBundleEntry {
  entry: BundleEntry;
  png: Buffer;
}

const DETERMINISTIC_ZIP_DATE = new Date("2000-01-01T00:00:00.000Z");
const BUNDLE_ZIP_FILENAME = "app-store-screenshots-bundle.zip";
const ALLOWED_BUNDLE_ZIP_FILENAMES = new Set([BUNDLE_ZIP_FILENAME, "web-share-package.zip"]);

export interface BundleExtraFile {
  relativePath: string;
  bytes: Buffer;
}

type StageHandle = Pick<FileHandle, "writeFile" | "sync" | "close">
  & Partial<Pick<FileHandle, "stat">>;
type VerificationHandle = Pick<FileHandle, "stat" | "readFile" | "close">;

interface StageIdentity {
  device: bigint;
  inode: bigint;
}

interface TrackedFileEvidence extends StageIdentity {
  links: bigint;
  bytes: Buffer;
}

interface CapturedError {
  value: unknown;
}

interface BundleOutputDependencies {
  makeTempDirectory?: typeof mkdtemp;
  move?: typeof rename;
  remove?: typeof rm;
  openStage?: (path: string, flags: number, mode: number) => Promise<StageHandle>;
  openVerification?: (path: string, flags: number) => Promise<VerificationHandle>;
  linkFile?: (source: string, destination: string) => Promise<void>;
  unlinkFile?: (path: string) => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withSecondaryError(primary: unknown, secondary: unknown, action: string): AggregateError {
  return new AggregateError(
    [primary, secondary],
    `${errorMessage(primary)}; ${action}: ${errorMessage(secondary)}`,
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

function collisionKey(relativePath: string): string {
  return relativePath.normalize("NFC").toLowerCase();
}

function resolveSafeBundleOutputPath(outDir: string, relativePath: string): string {
  if (!isProjectRelativePath(relativePath)) {
    throw new Error(`Unsafe bundle output path "${relativePath}"`);
  }
  const root = resolve(outDir);
  const outputPath = resolve(root, relativePath);
  const fromRoot = relative(root, outputPath);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Unsafe bundle output path "${relativePath}"`);
  }
  return outputPath;
}

function assertDirectoryNotSymlink(path: string, stats: Stats): void {
  if (stats.isSymbolicLink()) throw new Error(`Unsafe symbolic link in bundle output path "${path}"`);
  if (!stats.isDirectory()) throw new Error(`Bundle output ancestor is not a directory "${path}"`);
}

function assertRegularOutput(path: string, stats: Stats): void {
  if (stats.isSymbolicLink()) {
    throw new Error(`Unsafe symbolic link at bundle output file "${path}"`);
  }
  if (!stats.isFile()) {
    throw new Error(`Bundle output file must be a regular file "${path}"`);
  }
}

function assertContainedDirectory(root: string, directory: string): string[] {
  const fromRoot = relative(root, directory);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Bundle output directory escaped root "${directory}"`);
  }
  return fromRoot === "" ? [] : fromRoot.split(sep);
}

async function validateDirectoryChain(outDir: string, directory: string): Promise<boolean> {
  const root = resolve(outDir);
  const rootStats = await lstatIfExists(root);
  if (!rootStats) return false;
  assertDirectoryNotSymlink(root, rootStats);

  let current = root;
  for (const segment of assertContainedDirectory(root, directory)) {
    current = join(current, segment);
    const stats = await lstatIfExists(current);
    if (!stats) return false;
    assertDirectoryNotSymlink(current, stats);
  }
  return true;
}

async function preflightOutputPath(outDir: string, outputPath: string): Promise<Stats | null> {
  if (!await validateDirectoryChain(outDir, dirname(outputPath))) return null;
  const outputStats = await lstatIfExists(outputPath);
  if (outputStats) assertRegularOutput(outputPath, outputStats);
  return outputStats;
}

async function ensureSafeRootDirectory(outDir: string): Promise<void> {
  const root = resolve(outDir);
  const missingSegments: string[] = [];
  let cursor = root;
  let stats: Stats | null = null;

  while (!stats) {
    try {
      stats = await lstat(cursor);
    } catch (error) {
      if (!hasCode(error, "ENOENT") && !hasCode(error, "ENOTDIR")) throw error;
      const parent = dirname(cursor);
      if (parent === cursor) {
        throw new Error("Bundle output root has no existing directory ancestor", { cause: error });
      }
      missingSegments.unshift(basename(cursor));
      cursor = parent;
    }
  }
  assertDirectoryNotSymlink(cursor, stats);

  let current = cursor;
  for (const segment of missingSegments) {
    assertDirectoryNotSymlink(current, await lstat(current));
    current = join(current, segment);
    try {
      await mkdir(current);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
    }
    const currentStats = await lstat(current);
    assertDirectoryNotSymlink(current, currentStats);
  }
}

async function ensureSafeOutputDirectory(outDir: string, directory: string): Promise<void> {
  const root = resolve(outDir);
  const rootStats = await lstatIfExists(root);
  if (!rootStats) throw new Error(`Bundle output root disappeared "${root}"`);
  assertDirectoryNotSymlink(root, rootStats);

  let current = root;
  for (const segment of assertContainedDirectory(root, directory)) {
    const next = join(current, segment);
    let stats = await lstatIfExists(next);
    if (!stats) {
      if (!await validateDirectoryChain(outDir, current)) {
        throw new Error(`Bundle output ancestor disappeared "${current}"`);
      }
      try {
        await mkdir(next);
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
      }
      stats = await lstatIfExists(next);
    }
    if (!stats) throw new Error(`Bundle output ancestor disappeared "${next}"`);
    assertDirectoryNotSymlink(next, stats);
    current = next;
  }
}

function noFollowStageFlags(): number {
  return constants.O_WRONLY
    | constants.O_CREAT
    | constants.O_EXCL
    | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0);
}

function noFollowReadFlags(): number {
  return noFollowFlags(constants.O_RDONLY)
    | (typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0);
}

async function writeStagedFile(
  path: string,
  bytes: Buffer,
  openStage: NonNullable<BundleOutputDependencies["openStage"]>,
): Promise<StageIdentity> {
  let handle: StageHandle | undefined;
  let identity: StageIdentity | null = null;
  let primaryError: CapturedError | null = null;
  try {
    handle = await openStage(path, noFollowStageFlags(), 0o666);
    const stats = handle.stat
      ? await handle.stat({ bigint: true })
      : await lstat(path, { bigint: true });
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(`Bundle staged output must be a regular file "${path}"`);
    }
    identity = { device: stats.dev, inode: stats.ino };
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
        primaryError = {
          value: withSecondaryError(primaryError.value, closeError, "stage close failed"),
        };
      } else {
        primaryError = { value: closeError };
      }
    }
  }
  if (primaryError !== null) throw primaryError.value;
  if (identity === null) throw new Error(`Bundle stage identity was not captured "${path}"`);
  return identity;
}

async function requireOwnedStage(
  path: string,
  identity: StageIdentity,
  expectedBytes: Buffer,
  openVerification: NonNullable<BundleOutputDependencies["openVerification"]>,
): Promise<TrackedFileEvidence> {
  let evidence: TrackedFileEvidence;
  try {
    evidence = await readBoundRegularFileEvidence(path, openVerification);
  } catch (error) {
    throw new Error(`Bundle stage changed before publication "${path}"`, { cause: error });
  }
  if (
    evidence.device !== identity.device
    || evidence.inode !== identity.inode
    || evidence.links !== 1n
  ) {
    throw new Error(`Bundle stage changed after exclusive creation "${path}"`);
  }
  if (!evidence.bytes.equals(expectedBytes)) {
    throw new Error(`Bundle stage contents changed after staging "${path}"`);
  }
  return evidence;
}

async function readBoundRegularFileEvidence(
  path: string,
  openVerification: NonNullable<BundleOutputDependencies["openVerification"]>,
): Promise<TrackedFileEvidence> {
  let handle: VerificationHandle | undefined;
  let primaryError: CapturedError | null = null;
  let evidence: TrackedFileEvidence | null = null;
  try {
    handle = await openVerification(path, noFollowReadFlags());
    const stats = await handle.stat({ bigint: true });
    if (!stats.isFile()) throw new Error(`Tracked bundle file must be a regular file "${path}"`);
    evidence = {
      device: stats.dev,
      inode: stats.ino,
      links: stats.nlink,
      bytes: await handle.readFile(),
    };
  } catch (error) {
    primaryError = { value: error };
  }

  if (handle) {
    try {
      await handle.close();
    } catch (closeError) {
      if (primaryError !== null) {
        primaryError = {
          value: withSecondaryError(
            primaryError.value,
            closeError,
            "tracked file verification close failed",
          ),
        };
      } else {
        primaryError = {
          value: new Error(`Tracked bundle file verification close failed "${path}"`, {
            cause: closeError,
          }),
        };
      }
    }
  }
  if (primaryError !== null) throw primaryError.value;
  if (evidence === null) throw new Error(`Tracked bundle file evidence was not captured "${path}"`);

  const named = await lstatBigIntIfExists(path);
  if (
    !named?.isFile()
    || named.dev !== evidence.device
    || named.ino !== evidence.inode
    || named.nlink !== evidence.links
  ) {
    throw new Error(`Tracked bundle file name changed during verification "${path}"`);
  }
  return evidence;
}

function evidenceWithLinks(evidence: TrackedFileEvidence, links: bigint): TrackedFileEvidence {
  return { ...evidence, links };
}

function evidenceMatches(actual: TrackedFileEvidence, expected: TrackedFileEvidence): boolean {
  return actual.device === expected.device
    && actual.inode === expected.inode
    && actual.links === expected.links
    && actual.bytes.equals(expected.bytes);
}

function evidenceIdentityKey(evidence: TrackedFileEvidence): string {
  return `${evidence.device}:${evidence.inode}`;
}

function requireTrackedEvidence(
  evidence: TrackedFileEvidence | null,
  label: string,
  path: string,
): TrackedFileEvidence {
  if (!evidence) throw new Error(`${label} evidence is missing "${path}"`);
  return evidence;
}

async function requireExactTrackedFile(
  path: string,
  expected: TrackedFileEvidence,
  label: string,
  openVerification: NonNullable<BundleOutputDependencies["openVerification"]>,
): Promise<void> {
  let actual: TrackedFileEvidence;
  try {
    actual = await readBoundRegularFileEvidence(path, openVerification);
  } catch (error) {
    throw new Error(`${label} changed "${path}"`, { cause: error });
  }
  if (!evidenceMatches(actual, expected)) {
    throw new Error(`${label} changed "${path}"`);
  }
}

async function requireOutputAncestors(outDir: string, outputPath: string): Promise<void> {
  if (!await validateDirectoryChain(outDir, dirname(outputPath))) {
    throw new Error(`Bundle output ancestor disappeared "${dirname(outputPath)}"`);
  }
}

async function requireAbsentDestination(outDir: string, outputPath: string): Promise<void> {
  await requireOutputAncestors(outDir, outputPath);
  const stats = await lstatIfExists(outputPath);
  if (!stats) return;
  assertRegularOutput(outputPath, stats);
  throw new Error(`Bundle output destination changed before publication "${outputPath}"`);
}

async function removePublishedOutputSafely(
  outDir: string,
  outputPath: string,
  quarantinePath: string,
  expected: TrackedFileEvidence,
  move: NonNullable<BundleOutputDependencies["move"]>,
  openVerification: NonNullable<BundleOutputDependencies["openVerification"]>,
  linkFile: NonNullable<BundleOutputDependencies["linkFile"]>,
): Promise<void> {
  await requireOutputAncestors(outDir, outputPath);
  const stats = await lstatIfExists(outputPath);
  if (!stats) return;
  assertRegularOutput(outputPath, stats);

  await mkdir(dirname(quarantinePath), { recursive: true });
  if (await lstatIfExists(quarantinePath)) {
    throw new Error(`Bundle rollback quarantine is occupied "${quarantinePath}"`);
  }
  await move(outputPath, quarantinePath);

  let quarantined: TrackedFileEvidence;
  try {
    quarantined = await readBoundRegularFileEvidence(quarantinePath, openVerification);
  } catch (error) {
    throw new Error(`Bundle quarantined output changed "${quarantinePath}"`, { cause: error });
  }
  if (!evidenceMatches(quarantined, expected)) {
    try {
      await requireAbsentDestination(outDir, outputPath);
      await linkFile(quarantinePath, outputPath);
      const restoredCompetitor = evidenceWithLinks(quarantined, quarantined.links + 1n);
      await requireExactTrackedFile(
        quarantinePath,
        restoredCompetitor,
        "Bundle quarantined replacement",
        openVerification,
      );
      await requireExactTrackedFile(
        outputPath,
        restoredCompetitor,
        "Bundle restored replacement",
        openVerification,
      );
    } catch (restoreError) {
      throw new Error(
        `Bundle published output changed and its replacement could not be restored "${outputPath}"`,
        { cause: restoreError },
      );
    }
    throw new Error(`Bundle published output changed before rollback removal "${outputPath}"`);
  }
  if (await lstatIfExists(outputPath)) {
    throw new Error(`Bundle output destination was occupied during rollback "${outputPath}"`);
  }
}

async function restoreBackupSafely(
  outDir: string,
  backupPath: string,
  outputPath: string,
  backupEvidence: TrackedFileEvidence,
  openVerification: NonNullable<BundleOutputDependencies["openVerification"]>,
  linkFile: NonNullable<BundleOutputDependencies["linkFile"]>,
): Promise<TrackedFileEvidence> {
  await requireOutputAncestors(outDir, outputPath);
  const outputStats = await lstatIfExists(outputPath);
  if (outputStats) {
    throw new Error(`Cannot restore bundle backup over occupied destination "${outputPath}"`);
  }
  await requireExactTrackedFile(
    backupPath,
    backupEvidence,
    "Bundle backup",
    openVerification,
  );
  await linkFile(backupPath, outputPath);
  const linkedEvidence = evidenceWithLinks(backupEvidence, backupEvidence.links + 1n);
  await requireExactTrackedFile(
    backupPath,
    linkedEvidence,
    "Bundle linked backup",
    openVerification,
  );
  await requireExactTrackedFile(
    outputPath,
    linkedEvidence,
    "Bundle restored output",
    openVerification,
  );
  return linkedEvidence;
}

export async function writeBundleOutputs({
  outDir,
  entries,
  extraFiles = [],
  zipFilename = BUNDLE_ZIP_FILENAME,
  dependencies = {},
}: {
  outDir: string;
  entries: RenderedBundleEntry[];
  extraFiles?: BundleExtraFile[];
  zipFilename?: string;
  dependencies?: BundleOutputDependencies;
}): Promise<string> {
  if (!ALLOWED_BUNDLE_ZIP_FILENAMES.has(zipFilename)) {
    throw new Error(`Unsupported bundle zip filename "${zipFilename}"`);
  }
  const makeTempDirectory = dependencies.makeTempDirectory ?? mkdtemp;
  const move = dependencies.move ?? rename;
  const remove = dependencies.remove ?? rm;
  const openStage = dependencies.openStage ?? ((path, flags, mode) => open(path, flags, mode));
  const openVerification = dependencies.openVerification ?? ((path, flags) => open(path, flags));
  const linkFile = dependencies.linkFile ?? ((source, destination) => link(source, destination));
  const unlinkFile = dependencies.unlinkFile ?? ((path) => unlink(path));
  const seenPaths = new Set<string>([collisionKey(zipFilename)]);
  const files = [
    ...entries.map(({ entry, png }) => ({ relativePath: entry.relativePath, bytes: png })),
    ...extraFiles,
  ];
  const outputs = files.map(({ relativePath, bytes }) => {
    const outputPath = resolveSafeBundleOutputPath(outDir, relativePath);
    const key = collisionKey(relativePath);
    if (seenPaths.has(key)) {
      throw new Error(`Duplicate bundle output path "${relativePath}"`);
    }
    seenPaths.add(key);
    return { relativePath, bytes, outputPath };
  });
  const zipOutputPath = resolveSafeBundleOutputPath(outDir, zipFilename);
  const zipPath = join(outDir, zipFilename);
  const preflightPaths = [...outputs.map(({ outputPath }) => outputPath), zipOutputPath];
  for (const outputPath of preflightPaths) {
    await preflightOutputPath(outDir, outputPath);
  }

  const zip = new JSZip();
  for (const { relativePath, bytes } of outputs) {
    zip.file(relativePath, bytes, {
      createFolders: false,
      date: DETERMINISTIC_ZIP_DATE,
    });
  }
  const zipBytes = await zip.generateAsync({ type: "nodebuffer" });

  await ensureSafeRootDirectory(outDir);
  for (const outputPath of preflightPaths) {
    await preflightOutputPath(outDir, outputPath);
  }

  const stagingRoot = await makeTempDirectory(join(resolve(outDir), ".screenshot-studio-stage-"));
  const stagedFilesRoot = join(stagingRoot, "files");
  const backupRoot = join(stagingRoot, "backup");
  const quarantineRoot = join(stagingRoot, "quarantine");
  const publications = [
    ...outputs.map(({ relativePath, bytes, outputPath }) => ({
      relativePath,
      bytes,
      outputPath,
    })),
    {
      relativePath: zipFilename,
      bytes: zipBytes,
      outputPath: zipOutputPath,
    },
  ];

  let primaryError: CapturedError | null = null;
  let preserveStagingForRecovery = false;
  try {
    const stagedIdentities = new Map<string, StageIdentity>();
    for (const publication of publications) {
      const stagedPath = resolveSafeBundleOutputPath(stagedFilesRoot, publication.relativePath);
      await mkdir(dirname(stagedPath), { recursive: true });
      stagedIdentities.set(
        stagedPath,
        await writeStagedFile(stagedPath, publication.bytes, openStage),
      );
    }

    const applied: Array<{
      outputPath: string;
      backupPath: string;
      quarantinePath: string;
      backupMoved: boolean;
      backupEvidence: TrackedFileEvidence | null;
      published: boolean;
      publishedEvidence: TrackedFileEvidence | null;
      restoredEvidence: TrackedFileEvidence | null;
    }> = [];
    try {
      for (const [index, publication] of publications.entries()) {
        await preflightOutputPath(outDir, publication.outputPath);
        await ensureSafeOutputDirectory(outDir, dirname(publication.outputPath));
        const stagedPath = resolveSafeBundleOutputPath(stagedFilesRoot, publication.relativePath);
        const backupPath = join(backupRoot, String(index));
        const quarantinePath = join(quarantineRoot, String(index));
        const state = {
          outputPath: publication.outputPath,
          backupPath,
          quarantinePath,
          backupMoved: false,
          backupEvidence: null as TrackedFileEvidence | null,
          published: false,
          publishedEvidence: null as TrackedFileEvidence | null,
          restoredEvidence: null as TrackedFileEvidence | null,
        };
        applied.push(state);

        const existing = await preflightOutputPath(outDir, publication.outputPath);
        if (existing) {
          await mkdir(dirname(backupPath), { recursive: true });
          await preflightOutputPath(outDir, publication.outputPath);
          state.backupEvidence = await readBoundRegularFileEvidence(
            publication.outputPath,
            openVerification,
          );
          await move(publication.outputPath, backupPath);
          state.backupMoved = true;
          await requireExactTrackedFile(
            backupPath,
            state.backupEvidence,
            "Bundle backup",
            openVerification,
          );
        }

        await requireAbsentDestination(outDir, publication.outputPath);
        const stagedIdentity = stagedIdentities.get(stagedPath);
        if (!stagedIdentity) throw new Error(`Bundle stage identity is missing "${stagedPath}"`);
        const stageEvidence = await requireOwnedStage(
          stagedPath,
          stagedIdentity,
          publication.bytes,
          openVerification,
        );
        await linkFile(stagedPath, publication.outputPath);
        state.published = true;
        state.publishedEvidence = evidenceWithLinks(stageEvidence, 1n);
        const linkedEvidence = evidenceWithLinks(stageEvidence, 2n);
        await requireExactTrackedFile(
          stagedPath,
          linkedEvidence,
          "Bundle linked stage",
          openVerification,
        );
        await requireExactTrackedFile(
          publication.outputPath,
          linkedEvidence,
          "Bundle linked output",
          openVerification,
        );
        await unlinkFile(stagedPath);
        await requireExactTrackedFile(
          publication.outputPath,
          state.publishedEvidence,
          "Bundle published output",
          openVerification,
        );
      }
    } catch (publishError) {
      const rollbackErrors: unknown[] = [];
      const restoredLinkDeltas = new Map<string, bigint>();
      for (const state of applied.reverse()) {
        let outputRemoved = !state.published;
        if (state.published) {
          try {
            await removePublishedOutputSafely(
              outDir,
              state.outputPath,
              state.quarantinePath,
              requireTrackedEvidence(
                state.publishedEvidence,
                "Bundle published output",
                state.outputPath,
              ),
              move,
              openVerification,
              linkFile,
            );
            outputRemoved = true;
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
        }
        if (state.backupMoved && outputRemoved) {
          try {
            const backupEvidence = requireTrackedEvidence(
              state.backupEvidence,
              "Bundle backup",
              state.backupPath,
            );
            const identityKey = evidenceIdentityKey(backupEvidence);
            const restoredLinkDelta = restoredLinkDeltas.get(identityKey) ?? 0n;
            state.restoredEvidence = await restoreBackupSafely(
              outDir,
              state.backupPath,
              state.outputPath,
              evidenceWithLinks(backupEvidence, backupEvidence.links + restoredLinkDelta),
              openVerification,
              linkFile,
            );
            restoredLinkDeltas.set(identityKey, restoredLinkDelta + 1n);
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
        }
      }
      for (const state of applied) {
        if (!state.restoredEvidence) continue;
        try {
          const backupEvidence = requireTrackedEvidence(
            state.backupEvidence,
            "Bundle backup",
            state.backupPath,
          );
          const finalEvidence = evidenceWithLinks(
            backupEvidence,
            backupEvidence.links
              + (restoredLinkDeltas.get(evidenceIdentityKey(backupEvidence)) ?? 0n),
          );
          await requireExactTrackedFile(
            state.backupPath,
            finalEvidence,
            "Bundle retained backup",
            openVerification,
          );
          await requireExactTrackedFile(
            state.outputPath,
            finalEvidence,
            "Bundle restored output",
            openVerification,
          );
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length > 0) {
        preserveStagingForRecovery = true;
        throw new AggregateError(
          [publishError, ...rollbackErrors],
          `${errorMessage(publishError)}; bundle output rollback failed; recovery data retained at ${stagingRoot}`,
          { cause: publishError },
        );
      }
      throw publishError;
    }
  } catch (error) {
    primaryError = { value: error };
  }

  if (!preserveStagingForRecovery) {
    try {
      await remove(stagingRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      if (primaryError !== null) {
        throw withSecondaryError(primaryError.value, cleanupError, "staging cleanup failed");
      }
      throw cleanupError;
    }
  }
  if (primaryError !== null) throw primaryError.value;
  return zipPath;
}
