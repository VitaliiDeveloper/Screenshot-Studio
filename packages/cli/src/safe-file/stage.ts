// SPDX-License-Identifier: Apache-2.0
import { constants } from "node:fs";
import { lstat } from "node:fs/promises";
import { errorText, noFollowFlags } from "@screenshot-studio/core/storage";
import type {
  CapturedError,
  OpenEvidence,
  PublicationDependencies,
  StageHandle,
  StageIdentity,
  TrackedFileEvidence,
} from "./types.js";
import { errorWithCleanup } from "./fs-basics.js";
import {
  namedStageIdentity,
  readBoundRegularFileEvidence,
  stageIdentity,
} from "./evidence.js";
import {
  privateQuarantinePath,
  quarantineEntry,
  recoveryEntryStatus,
  removeExactQuarantineReconciled,
  restoreQuarantinedEntryNoReplace,
} from "./quarantine.js";

async function cleanupFailedOwnedStage(
  stagePath: string,
  identity: StageIdentity,
  removeStage: NonNullable<PublicationDependencies["removeStage"]>,
  quarantineFile: NonNullable<PublicationDependencies["quarantineFile"]>,
  restoreLink: NonNullable<PublicationDependencies["restoreLink"]>,
  openVerification: OpenEvidence,
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
export async function createOwnedStage(
  stagePath: string,
  bytes: Uint8Array,
  openStage: NonNullable<PublicationDependencies["openStage"]>,
  removeStage: NonNullable<PublicationDependencies["removeStage"]>,
  quarantineFile: NonNullable<PublicationDependencies["quarantineFile"]>,
  restoreLink: NonNullable<PublicationDependencies["restoreLink"]>,
  openVerification: OpenEvidence,
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
    if (owned) {
      try {
        // The exclusive open created the stage even when handle.stat() failed before binding it.
        const ownedIdentity = identity ?? await namedStageIdentity(stagePath, bytes);
        if (ownedIdentity) {
          await cleanupFailedOwnedStage(
            stagePath,
            ownedIdentity,
            removeStage,
            quarantineFile,
            restoreLink,
            openVerification,
            revalidateBeforeRemoval,
          );
        }
      } catch (cleanupError) {
        throw errorWithCleanup(primaryError.value, cleanupError);
      }
    }
    throw primaryError.value;
  }
  return identity!;
}
