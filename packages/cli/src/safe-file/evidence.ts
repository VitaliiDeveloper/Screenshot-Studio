// SPDX-License-Identifier: Apache-2.0
// Device, inode, link-count, and content evidence that proves which file an operation owns.
import { type BigIntStats } from "node:fs";
import { lstat } from "node:fs/promises";
import { errorText } from "@screenshot-studio/core/storage";
import { SafeFileConflictError } from "./types.js";
import type {
  CapturedError,
  FilePublicationDestinationState,
  InspectionHandle,
  PublicationDependencies,
  PublicationInspectionDependencies,
  SafeFileOwnership,
  StageIdentity,
  TrackedFileEvidence,
  VerificationHandle,
} from "./types.js";
import {
  contentRevision,
  lstatBigIntIfExists,
  publicationDestinationError,
  verificationFlags,
} from "./fs-basics.js";

function compareBoundedFileIdentity(
  actual: BigIntStats,
  expected: BigIntStats,
): "stable" | "link-transition" | "changed" {
  if (actual.dev !== expected.dev
    || actual.ino !== expected.ino
    || actual.size !== expected.size
    || actual.mtimeNs !== expected.mtimeNs) {
    return "changed";
  }
  if (actual.ctimeNs === expected.ctimeNs && actual.nlink === expected.nlink) {
    return "stable";
  }
  return actual.nlink !== expected.nlink ? "link-transition" : "changed";
}
export async function destinationMatches(
  path: string,
  bytes: Uint8Array,
  openVerification: NonNullable<PublicationDependencies["openVerification"]>,
): Promise<TrackedFileEvidence | null> {
  const inspection = await inspectBoundedDestinationBytes(path, bytes, openVerification);
  return inspection.state === "matching" ? inspection.evidence : null;
}
export function stageIdentity(stats: BigIntStats, bytes: Uint8Array): StageIdentity {
  return { device: stats.dev, inode: stats.ino, revision: contentRevision(bytes) };
}
export function evidenceWithLinks(
  evidence: TrackedFileEvidence,
  links: bigint,
): TrackedFileEvidence {
  return { ...evidence, links };
}
export function evidenceMatches(
  actual: TrackedFileEvidence,
  expected: TrackedFileEvidence,
): boolean {
  return actual.device === expected.device
    && actual.inode === expected.inode
    && actual.links === expected.links
    && actual.revision === expected.revision
    && actual.bytes.equals(expected.bytes);
}
export function evidenceMatchesIdentityAndBytes(
  actual: TrackedFileEvidence,
  expected: TrackedFileEvidence,
): boolean {
  return actual.device === expected.device
    && actual.inode === expected.inode
    && actual.revision === expected.revision
    && actual.bytes.equals(expected.bytes);
}
export function expectedEvidence(
  identity: StageIdentity,
  links: bigint,
  bytes: Uint8Array,
): TrackedFileEvidence {
  return { ...identity, links, bytes: Buffer.from(bytes) };
}
export async function readBoundRegularFileEvidence(
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
export async function inspectBoundedDestinationBytes(
  path: string,
  expected: Uint8Array,
  openVerification: NonNullable<PublicationInspectionDependencies["openVerification"]>,
): Promise<{
  state: FilePublicationDestinationState;
  evidence: TrackedFileEvidence | null;
}> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const initial = await lstatBigIntIfExists(path);
    if (!initial) return { state: "missing", evidence: null };
    if (!initial.isFile()) throw publicationDestinationError(path, await lstat(path));
    if (initial.size !== BigInt(expected.byteLength)) {
      return { state: "conflicting", evidence: null };
    }

    let handle: InspectionHandle;
    try {
      handle = await openVerification(path, verificationFlags());
    } catch (error) {
      throw new Error(`Publication destination changed during bounded comparison: ${path}`, { cause: error });
    }

    let primaryError: CapturedError | null = null;
    let retryForLinkTransition = false;
    let inspection: {
      state: FilePublicationDestinationState;
      evidence: TrackedFileEvidence;
      identity: BigIntStats;
    } | null = null;
    try {
      const opened = await handle.stat({ bigint: true });
      const namedBeforeRead = await lstatBigIntIfExists(path);
      if (!opened.isFile() || !namedBeforeRead?.isFile()) {
        throw new Error(`Publication destination changed during bounded comparison: ${path}`);
      }
      const beforeStates = [
        compareBoundedFileIdentity(opened, initial),
        compareBoundedFileIdentity(namedBeforeRead, opened),
      ];
      if (beforeStates.includes("changed")) {
        throw new Error(`Publication destination changed during bounded comparison: ${path}`);
      }
      retryForLinkTransition = beforeStates.includes("link-transition");

      if (!retryForLinkTransition) {
        const bytes = Buffer.alloc(expected.byteLength);
        let offset = 0;
        while (offset < bytes.length) {
          const result = await handle.read(bytes, offset, bytes.length - offset, offset);
          if (result.bytesRead === 0) break;
          offset += result.bytesRead;
        }
        const openedAfterRead = await handle.stat({ bigint: true });
        const namedWhileOpen = await lstatBigIntIfExists(path);
        if (!openedAfterRead.isFile() || !namedWhileOpen?.isFile()) {
          throw new Error(`Publication destination changed during bounded comparison: ${path}`);
        }
        const afterStates = [
          compareBoundedFileIdentity(openedAfterRead, opened),
          compareBoundedFileIdentity(namedWhileOpen, openedAfterRead),
        ];
        if (afterStates.includes("changed")) {
          throw new Error(`Publication destination changed during bounded comparison: ${path}`);
        }
        retryForLinkTransition = afterStates.includes("link-transition");
        if (!retryForLinkTransition) {
          inspection = {
            state: offset === bytes.length && bytes.equals(Buffer.from(expected))
              ? "matching"
              : "conflicting",
            evidence: {
              device: openedAfterRead.dev,
              inode: openedAfterRead.ino,
              links: namedWhileOpen.nlink,
              revision: contentRevision(bytes),
              bytes,
            },
            identity: namedWhileOpen,
          };
        }
      }
    } catch (error) {
      primaryError = { value: error };
    }

    try {
      await handle.close();
    } catch (closeError) {
      primaryError = primaryError === null
        ? { value: closeError }
        : { value: new AggregateError(
            [primaryError.value, closeError],
            `${errorText(primaryError.value)}; publication inspection close failed: ${errorText(closeError)}`,
            { cause: primaryError.value },
          ) };
    }
    if (primaryError !== null) throw primaryError.value;
    if (retryForLinkTransition) continue;
    if (inspection === null) {
      throw new Error(`Publication destination changed during bounded comparison: ${path}`);
    }

    const named = await lstatBigIntIfExists(path);
    if (!named?.isFile()) {
      throw new Error(`Publication destination changed after bounded comparison: ${path}`);
    }
    const finalState = compareBoundedFileIdentity(named, inspection.identity);
    if (finalState === "link-transition") continue;
    if (finalState === "changed") {
      throw new Error(`Publication destination changed after bounded comparison: ${path}`);
    }
    return { state: inspection.state, evidence: inspection.evidence };
  }
  throw new SafeFileConflictError(
    path,
    `Publication destination did not stabilize during bounded comparison: ${path}`,
  );
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
export async function requireCommittedDestination(
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
export async function requireCommittedDestinationLinkRange(
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
export async function reconcileHardLinkPublication(
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
export async function reconcileRenamePublication(
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
export async function requireOwnedStage(
  path: string,
  identity: StageIdentity,
  openVerification: NonNullable<PublicationDependencies["openVerification"]>,
): Promise<void> {
  if (!await inspectOwnedStage(path, identity, 1n, openVerification)) {
    throw new Error(`Publication stage disappeared after exclusive creation: ${path}`);
  }
}
export function ownershipFromEvidence(evidence: TrackedFileEvidence): SafeFileOwnership {
  return {
    device: evidence.device,
    inode: evidence.inode,
    revision: evidence.revision,
  };
}
export function ownershipMatchesEvidence(
  ownership: SafeFileOwnership,
  evidence: TrackedFileEvidence,
): boolean {
  return ownership.device === evidence.device
    && ownership.inode === evidence.inode
    && ownership.revision === evidence.revision;
}
