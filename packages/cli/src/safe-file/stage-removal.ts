// SPDX-License-Identifier: Apache-2.0
import { errorText } from "@screenshot-studio/core/storage";
import type {
  CapturedError,
  PublicationDependencies,
  StageIdentity,
  TrackedFileEvidence,
} from "./types.js";
import { errorWithCleanup, lstatIfExists } from "./fs-basics.js";
import {
  evidenceMatches,
  evidenceMatchesIdentityAndBytes,
  evidenceWithLinks,
  expectedEvidence,
  readBoundRegularFileEvidence,
  requireCommittedDestination,
  requireCommittedDestinationLinkRange,
} from "./evidence.js";
import {
  privateQuarantinePath,
  quarantineEntry,
  recoveryEntryStatus,
  removeExactQuarantine,
  removeExactQuarantineReconciled,
  restoreQuarantinedEntryNoReplace,
} from "./quarantine.js";

export async function removeOwnedStage(
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
