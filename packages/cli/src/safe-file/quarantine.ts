// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { errorText } from "@screenshot-studio/core/storage";
import type {
  CapturedError,
  PublicationDependencies,
  QuarantineOutcome,
  TrackedFileEvidence,
} from "./types.js";
import { lstatBigIntIfExists, lstatIfExists } from "./fs-basics.js";
import { evidenceMatches, evidenceWithLinks, readBoundRegularFileEvidence } from "./evidence.js";

export async function quarantineEntry(
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
export function privateQuarantinePath(stagePath: string, purpose: string): string {
  return `${stagePath}.${randomUUID()}.${purpose}`;
}
export async function recoveryEntryStatus(path: string): Promise<string> {
  return await lstatIfExists(path)
    ? `recovery retained at ${path}`
    : `recovery entry disappeared from ${path}`;
}
export async function requireExactEvidence(
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
export async function restoreQuarantinedEntryNoReplace(
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
export async function removeExactQuarantine(
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
export async function removeExactQuarantineReconciled(
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
