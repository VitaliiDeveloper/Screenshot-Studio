// SPDX-License-Identifier: Apache-2.0
import {
  link,
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import JSZip from "jszip";
import type { BundleEntry } from "@screenshot-studio/core/export";
import { isProjectRelativePath } from "@screenshot-studio/core/model";
import { errorText } from "@screenshot-studio/core/storage";
import {
  evidenceMatches,
  evidenceWithLinks,
  readBoundRegularFileEvidence,
} from "./safe-file/evidence.js";
import {
  errorWithCleanup,
  lstatIfExists,
  publicationDestinationError,
} from "./safe-file/fs-basics.js";
import {
  assertCanonicalContainment,
  ensureAncestors,
  inspectRegularLeaf,
  resolveOrCreateRootBoundary,
  resolveRootBoundaryIfExists,
  revalidateAncestors,
} from "./safe-file/paths.js";
import {
  quarantineEntry,
  requireExactEvidence,
  restoreQuarantinedEntryNoReplace,
} from "./safe-file/quarantine.js";
import { createOwnedStage } from "./safe-file/stage.js";
import type {
  CapturedError,
  OpenEvidence,
  RootBoundary,
  StageHandle,
  StageIdentity,
  TrackedFileEvidence,
} from "./safe-file/types.js";

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

interface BundleOutputDependencies {
  makeTempDirectory?: typeof mkdtemp;
  move?: typeof rename;
  remove?: typeof rm;
  openStage?: (path: string, flags: number, mode: number) => Promise<StageHandle>;
  openVerification?: OpenEvidence;
  linkFile?: (source: string, destination: string) => Promise<void>;
  unlinkFile?: (path: string) => Promise<void>;
}

type FileOperations = Required<BundleOutputDependencies>;

const DEFAULT_FILE_OPERATIONS: FileOperations = {
  makeTempDirectory: mkdtemp,
  move: rename,
  remove: rm,
  openStage: (path, flags, mode) => open(path, flags, mode),
  openVerification: (path, flags) => open(path, flags),
  linkFile: link,
  unlinkFile: unlink,
};

interface BundlePublication {
  relativePath: string;
  bytes: Buffer;
  outputPath: string;
}

interface StagedPublication extends BundlePublication {
  stagedPath: string;
  identity: StageIdentity;
}

interface AppliedPublication {
  outputPath: string;
  backupPath: string;
  quarantinePath: string;
  revalidate: () => Promise<void>;
  backup: TrackedFileEvidence | null;
  published: TrackedFileEvidence | null;
}

function collisionKey(relativePath: string): string {
  return relativePath.normalize("NFC").toLowerCase();
}

function resolveSafeBundleOutputPath(root: string, relativePath: string): string {
  if (!isProjectRelativePath(relativePath)) {
    throw new Error(`Unsafe bundle output path "${relativePath}"`);
  }
  const outputPath = resolve(root, relativePath);
  assertCanonicalContainment(root, outputPath);
  return outputPath;
}

function directorySegments(relativePath: string): string[] {
  return relativePath.split("/").slice(0, -1);
}

function inspectOutputLeaf(outputPath: string) {
  return inspectRegularLeaf(outputPath, publicationDestinationError);
}

async function preflightOutput(
  boundary: RootBoundary | null,
  relativePath: string,
  outputPath: string,
): Promise<void> {
  if (!boundary || !await ensureAncestors(boundary, directorySegments(relativePath), false)) return;
  await inspectOutputLeaf(outputPath);
}

/** Creates the directory chain of one file and returns the check to repeat before each mutation. */
async function ensureDirectories(
  boundary: RootBoundary,
  relativePath: string,
): Promise<() => Promise<void>> {
  const ancestors = await ensureAncestors(boundary, directorySegments(relativePath), true);
  if (!ancestors) throw new Error(`Bundle directory creation failed "${relativePath}"`);
  return () => revalidateAncestors(boundary, ancestors);
}

async function stagePublications(
  stagedFilesRoot: string,
  publications: BundlePublication[],
  operations: FileOperations,
): Promise<StagedPublication[]> {
  const boundary = await resolveOrCreateRootBoundary(stagedFilesRoot);
  const staged: StagedPublication[] = [];
  for (const publication of publications) {
    const stagedPath = resolveSafeBundleOutputPath(stagedFilesRoot, publication.relativePath);
    const revalidate = await ensureDirectories(boundary, publication.relativePath);
    const identity = await createOwnedStage(
      stagedPath,
      publication.bytes,
      operations.openStage,
      unlink,
      rename,
      link,
      operations.openVerification,
      revalidate,
    );
    staged.push({ ...publication, stagedPath, identity });
  }
  return staged;
}

async function requireOwnedStage(
  { stagedPath, identity, bytes }: StagedPublication,
  openVerification: OpenEvidence,
): Promise<TrackedFileEvidence> {
  const evidence = await readBoundRegularFileEvidence(
    stagedPath,
    openVerification,
    "Bundle stage changed before publication",
  );
  if (
    !evidence
    || evidence.device !== identity.device
    || evidence.inode !== identity.inode
    || evidence.links !== 1n
  ) {
    throw new Error(`Bundle stage changed after exclusive creation "${stagedPath}"`);
  }
  if (!evidence.bytes.equals(bytes)) {
    throw new Error(`Bundle stage contents changed after staging "${stagedPath}"`);
  }
  return evidence;
}

async function moveOutputToBackup(state: AppliedPublication, operations: FileOperations): Promise<void> {
  const { outputPath, backupPath, revalidate } = state;
  await mkdir(dirname(backupPath), { recursive: true });
  const evidence = await readBoundRegularFileEvidence(
    outputPath,
    operations.openVerification,
    "Bundle output changed before backup",
  );
  if (!evidence) throw new Error(`Bundle output disappeared before backup "${outputPath}"`);
  const moved = await quarantineEntry(outputPath, backupPath, operations.move, revalidate);
  // A move that reports failure may still have committed; rollback must then restore the backup.
  if (moved.captured) state.backup = evidence;
  if (moved.error !== null) throw moved.error.value;
  if (!moved.captured) throw new Error(`Bundle output disappeared before backup "${outputPath}"`);
  await requireExactEvidence(backupPath, evidence, "Bundle backup changed", operations.openVerification);
}

async function publishFile(
  publication: StagedPublication,
  stagingRoot: string,
  index: number,
  boundary: RootBoundary,
  operations: FileOperations,
  applied: AppliedPublication[],
): Promise<void> {
  const { outputPath, stagedPath, relativePath } = publication;
  const { openVerification } = operations;
  const revalidate = await ensureDirectories(boundary, relativePath);
  const state: AppliedPublication = {
    outputPath,
    backupPath: join(stagingRoot, "backup", String(index)),
    quarantinePath: join(stagingRoot, "quarantine", String(index)),
    revalidate,
    backup: null,
    published: null,
  };
  applied.push(state);

  if (await inspectOutputLeaf(outputPath)) await moveOutputToBackup(state, operations);

  await revalidate();
  if (await inspectOutputLeaf(outputPath)) {
    throw new Error(`Bundle output destination changed before publication "${outputPath}"`);
  }
  const stageEvidence = await requireOwnedStage(publication, openVerification);
  await operations.linkFile(stagedPath, outputPath);
  state.published = evidenceWithLinks(stageEvidence, 1n);
  const linked = evidenceWithLinks(stageEvidence, 2n);
  await requireExactEvidence(stagedPath, linked, "Bundle linked stage changed", openVerification);
  await requireExactEvidence(outputPath, linked, "Bundle linked output changed", openVerification);
  await operations.unlinkFile(stagedPath);
  await requireExactEvidence(outputPath, state.published, "Bundle published output changed", openVerification);
}

async function movePublishedOutputToQuarantine(
  { outputPath, quarantinePath, revalidate }: AppliedPublication,
  expected: TrackedFileEvidence,
  operations: FileOperations,
): Promise<void> {
  await revalidate();
  if (!await inspectOutputLeaf(outputPath)) return;

  await mkdir(dirname(quarantinePath), { recursive: true });
  if (await lstatIfExists(quarantinePath)) {
    throw new Error(`Bundle rollback quarantine is occupied "${quarantinePath}"`);
  }
  const moved = await quarantineEntry(outputPath, quarantinePath, operations.move, revalidate);
  if (moved.error !== null) throw moved.error.value;
  if (!moved.captured) return;

  const quarantined = await readBoundRegularFileEvidence(
    quarantinePath,
    operations.openVerification,
    "Bundle quarantined output changed",
  );
  if (!quarantined) throw new Error(`Bundle quarantined output disappeared "${quarantinePath}"`);
  if (!evidenceMatches(quarantined, expected)) {
    try {
      await restoreQuarantinedEntryNoReplace(
        quarantinePath,
        outputPath,
        quarantined,
        operations.linkFile,
        operations.openVerification,
        revalidate,
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

function evidenceIdentityKey(evidence: TrackedFileEvidence): string {
  return `${evidence.device}:${evidence.inode}`;
}

async function rollBackPublications(
  applied: AppliedPublication[],
  operations: FileOperations,
): Promise<unknown[]> {
  const { openVerification, linkFile } = operations;
  const errors: unknown[] = [];
  // Backups of one hard-linked inode gain a link with every restore, so later checks must expect it.
  const restoredLinks = new Map<string, bigint>();
  const restored: Array<{ state: AppliedPublication; backup: TrackedFileEvidence }> = [];

  for (const state of [...applied].reverse()) {
    let outputRemoved = true;
    if (state.published) {
      try {
        await movePublishedOutputToQuarantine(state, state.published, operations);
      } catch (error) {
        errors.push(error);
        outputRemoved = false;
      }
    }
    if (state.backup && outputRemoved) {
      try {
        const key = evidenceIdentityKey(state.backup);
        const links = restoredLinks.get(key) ?? 0n;
        const expected = evidenceWithLinks(state.backup, state.backup.links + links);
        await requireExactEvidence(state.backupPath, expected, "Bundle backup changed", openVerification);
        await restoreQuarantinedEntryNoReplace(
          state.backupPath,
          state.outputPath,
          expected,
          linkFile,
          openVerification,
          state.revalidate,
        );
        restoredLinks.set(key, links + 1n);
        restored.push({ state, backup: state.backup });
      } catch (error) {
        errors.push(error);
      }
    }
  }

  for (const { state, backup } of restored) {
    try {
      const links = restoredLinks.get(evidenceIdentityKey(backup)) ?? 0n;
      const expected = evidenceWithLinks(backup, backup.links + links);
      await requireExactEvidence(state.backupPath, expected, "Bundle retained backup changed", openVerification);
      await requireExactEvidence(state.outputPath, expected, "Bundle restored output changed", openVerification);
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
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
  const operations: FileOperations = { ...DEFAULT_FILE_OPERATIONS, ...dependencies };
  // Paths stay on the requested root; safe-file checks them against its canonical form.
  const root = resolve(outDir);
  const seenPaths = new Set<string>([collisionKey(zipFilename)]);
  const files = [
    ...entries.map(({ entry, png }) => ({ relativePath: entry.relativePath, bytes: png })),
    ...extraFiles,
  ];
  const outputs = files.map(({ relativePath, bytes }): BundlePublication => {
    const outputPath = resolveSafeBundleOutputPath(root, relativePath);
    const key = collisionKey(relativePath);
    if (seenPaths.has(key)) {
      throw new Error(`Duplicate bundle output path "${relativePath}"`);
    }
    seenPaths.add(key);
    return { relativePath, bytes, outputPath };
  });
  const zipOutputPath = resolveSafeBundleOutputPath(root, zipFilename);
  const preflightTargets = [...outputs, { relativePath: zipFilename, outputPath: zipOutputPath }];
  const existingBoundary = await resolveRootBoundaryIfExists(outDir);
  for (const { relativePath, outputPath } of preflightTargets) {
    await preflightOutput(existingBoundary, relativePath, outputPath);
  }

  const zip = new JSZip();
  for (const { relativePath, bytes } of outputs) {
    zip.file(relativePath, bytes, {
      createFolders: false,
      date: DETERMINISTIC_ZIP_DATE,
    });
  }
  const zipBytes = await zip.generateAsync({ type: "nodebuffer" });

  const boundary = await resolveOrCreateRootBoundary(outDir);
  for (const { relativePath, outputPath } of preflightTargets) {
    await preflightOutput(boundary, relativePath, outputPath);
  }

  const stagingRoot = await operations.makeTempDirectory(join(root, ".screenshot-studio-stage-"));
  const publications = [
    ...outputs,
    { relativePath: zipFilename, bytes: zipBytes, outputPath: zipOutputPath },
  ];

  let primaryError: CapturedError | null = null;
  let preserveStagingForRecovery = false;
  try {
    const staged = await stagePublications(join(stagingRoot, "files"), publications, operations);
    const applied: AppliedPublication[] = [];
    try {
      for (const [index, publication] of staged.entries()) {
        await publishFile(publication, stagingRoot, index, boundary, operations, applied);
      }
    } catch (publishError) {
      const rollbackErrors = await rollBackPublications(applied, operations);
      if (rollbackErrors.length > 0) {
        preserveStagingForRecovery = true;
        throw new AggregateError(
          [publishError, ...rollbackErrors],
          `${errorText(publishError)}; bundle output rollback failed; recovery data retained at ${stagingRoot}`,
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
      await operations.remove(stagingRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      if (primaryError !== null) {
        throw errorWithCleanup(primaryError.value, cleanupError, "staging cleanup failed");
      }
      throw cleanupError;
    }
  }
  if (primaryError !== null) throw primaryError.value;
  return join(outDir, zipFilename);
}
