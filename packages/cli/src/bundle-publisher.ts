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
import { requireExactEvidence } from "./safe-file/quarantine.js";
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

async function inspectOutputLeaf(outputPath: string) {
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
  const revalidate = () => revalidateAncestors(boundary, ancestors);
  // ensureAncestors checks nothing for a file directly in the root, so the root is checked here.
  await revalidate();
  return revalidate;
}

async function requireOwnedStage(
  path: string,
  identity: StageIdentity,
  expectedBytes: Buffer,
  openVerification: OpenEvidence,
): Promise<TrackedFileEvidence> {
  const evidence = await readBoundRegularFileEvidence(
    path,
    openVerification,
    "Bundle stage changed before publication",
  );
  if (
    !evidence
    || evidence.device !== identity.device
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

async function requireAbsentDestination(
  outputPath: string,
  revalidate: () => Promise<void>,
): Promise<void> {
  await revalidate();
  if (await inspectOutputLeaf(outputPath)) {
    throw new Error(`Bundle output destination changed before publication "${outputPath}"`);
  }
}

async function removePublishedOutputSafely(
  outputPath: string,
  quarantinePath: string,
  expected: TrackedFileEvidence,
  revalidate: () => Promise<void>,
  move: NonNullable<BundleOutputDependencies["move"]>,
  openVerification: OpenEvidence,
  linkFile: NonNullable<BundleOutputDependencies["linkFile"]>,
): Promise<void> {
  await revalidate();
  if (!await inspectOutputLeaf(outputPath)) return;

  await mkdir(dirname(quarantinePath), { recursive: true });
  if (await lstatIfExists(quarantinePath)) {
    throw new Error(`Bundle rollback quarantine is occupied "${quarantinePath}"`);
  }
  await move(outputPath, quarantinePath);

  const quarantined = await readBoundRegularFileEvidence(
    quarantinePath,
    openVerification,
    "Bundle quarantined output changed",
  );
  if (!quarantined) throw new Error(`Bundle quarantined output disappeared "${quarantinePath}"`);
  if (!evidenceMatches(quarantined, expected)) {
    try {
      await requireAbsentDestination(outputPath, revalidate);
      await linkFile(quarantinePath, outputPath);
      const restoredCompetitor = evidenceWithLinks(quarantined, quarantined.links + 1n);
      await requireExactEvidence(
        quarantinePath,
        restoredCompetitor,
        "Bundle quarantined replacement changed",
        openVerification,
      );
      await requireExactEvidence(
        outputPath,
        restoredCompetitor,
        "Bundle restored replacement changed",
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
  backupPath: string,
  outputPath: string,
  backupEvidence: TrackedFileEvidence,
  revalidate: () => Promise<void>,
  openVerification: OpenEvidence,
  linkFile: NonNullable<BundleOutputDependencies["linkFile"]>,
): Promise<TrackedFileEvidence> {
  await revalidate();
  if (await lstatIfExists(outputPath)) {
    throw new Error(`Cannot restore bundle backup over occupied destination "${outputPath}"`);
  }
  await requireExactEvidence(
    backupPath,
    backupEvidence,
    "Bundle backup changed",
    openVerification,
  );
  await linkFile(backupPath, outputPath);
  const linkedEvidence = evidenceWithLinks(backupEvidence, backupEvidence.links + 1n);
  await requireExactEvidence(
    backupPath,
    linkedEvidence,
    "Bundle linked backup changed",
    openVerification,
  );
  await requireExactEvidence(
    outputPath,
    linkedEvidence,
    "Bundle restored output changed",
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
  const root = resolve(outDir);
  const outputs = files.map(({ relativePath, bytes }) => {
    const outputPath = resolveSafeBundleOutputPath(root, relativePath);
    const key = collisionKey(relativePath);
    if (seenPaths.has(key)) {
      throw new Error(`Duplicate bundle output path "${relativePath}"`);
    }
    seenPaths.add(key);
    return { relativePath, bytes, outputPath };
  });
  const zipOutputPath = resolveSafeBundleOutputPath(root, zipFilename);
  const zipPath = join(outDir, zipFilename);
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

  const stagingRoot = await makeTempDirectory(join(root, ".screenshot-studio-stage-"));
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
    const stageBoundary = await resolveOrCreateRootBoundary(stagedFilesRoot);
    for (const publication of publications) {
      const stagedPath = resolveSafeBundleOutputPath(stagedFilesRoot, publication.relativePath);
      const revalidateStage = await ensureDirectories(stageBoundary, publication.relativePath);
      stagedIdentities.set(
        stagedPath,
        await createOwnedStage(
          stagedPath,
          publication.bytes,
          openStage,
          unlink,
          rename,
          link,
          openVerification,
          revalidateStage,
        ),
      );
    }

    const applied: Array<{
      outputPath: string;
      backupPath: string;
      quarantinePath: string;
      revalidate: () => Promise<void>;
      backupMoved: boolean;
      backupEvidence: TrackedFileEvidence | null;
      published: boolean;
      publishedEvidence: TrackedFileEvidence | null;
      restoredEvidence: TrackedFileEvidence | null;
    }> = [];
    try {
      for (const [index, publication] of publications.entries()) {
        const revalidate = await ensureDirectories(boundary, publication.relativePath);
        const stagedPath = resolveSafeBundleOutputPath(stagedFilesRoot, publication.relativePath);
        const backupPath = join(backupRoot, String(index));
        const quarantinePath = join(quarantineRoot, String(index));
        const state = {
          outputPath: publication.outputPath,
          backupPath,
          quarantinePath,
          revalidate,
          backupMoved: false,
          backupEvidence: null as TrackedFileEvidence | null,
          published: false,
          publishedEvidence: null as TrackedFileEvidence | null,
          restoredEvidence: null as TrackedFileEvidence | null,
        };
        applied.push(state);

        if (await inspectOutputLeaf(publication.outputPath)) {
          await mkdir(dirname(backupPath), { recursive: true });
          await revalidate();
          await inspectOutputLeaf(publication.outputPath);
          state.backupEvidence = await readBoundRegularFileEvidence(
            publication.outputPath,
            openVerification,
            "Bundle output changed before backup",
          );
          if (!state.backupEvidence) {
            throw new Error(`Bundle output disappeared before backup "${publication.outputPath}"`);
          }
          await move(publication.outputPath, backupPath);
          state.backupMoved = true;
          await requireExactEvidence(
            backupPath,
            state.backupEvidence,
            "Bundle backup changed",
            openVerification,
          );
        }

        await requireAbsentDestination(publication.outputPath, revalidate);
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
        await requireExactEvidence(
          stagedPath,
          linkedEvidence,
          "Bundle linked stage changed",
          openVerification,
        );
        await requireExactEvidence(
          publication.outputPath,
          linkedEvidence,
          "Bundle linked output changed",
          openVerification,
        );
        await unlinkFile(stagedPath);
        await requireExactEvidence(
          publication.outputPath,
          state.publishedEvidence,
          "Bundle published output changed",
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
              state.outputPath,
              state.quarantinePath,
              requireTrackedEvidence(
                state.publishedEvidence,
                "Bundle published output",
                state.outputPath,
              ),
              state.revalidate,
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
              state.backupPath,
              state.outputPath,
              evidenceWithLinks(backupEvidence, backupEvidence.links + restoredLinkDelta),
              state.revalidate,
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
          await requireExactEvidence(
            state.backupPath,
            finalEvidence,
            "Bundle retained backup changed",
            openVerification,
          );
          await requireExactEvidence(
            state.outputPath,
            finalEvidence,
            "Bundle restored output changed",
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
      await remove(stagingRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      if (primaryError !== null) {
        throw errorWithCleanup(primaryError.value, cleanupError, "staging cleanup failed");
      }
      throw cleanupError;
    }
  }
  if (primaryError !== null) throw primaryError.value;
  return zipPath;
}
