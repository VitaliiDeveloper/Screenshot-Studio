// SPDX-License-Identifier: Apache-2.0
import { link, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { errorText } from "@screenshot-studio/core/storage";
import type {
  CapturedError,
  QuarantineOutcome,
  RemovalDependencies,
  SafeFileOwnership,
  SafeRegularFileQuarantine,
  TrackedFileEvidence,
} from "./types.js";
import { hasCode, lstatBigIntIfExists, lstatIfExists, removalTargetError } from "./fs-basics.js";
import {
  assertCanonicalContainment,
  assertPortableRelativePath,
  ensureAncestors,
  inspectRegularLeaf,
  resolveRootBoundaryIfExists,
  revalidateAncestors,
} from "./paths.js";
import {
  evidenceMatches,
  evidenceWithLinks,
  ownershipFromEvidence,
  ownershipMatchesEvidence,
  readBoundRegularFileEvidence,
} from "./evidence.js";
import {
  privateQuarantinePath,
  quarantineEntry,
  recoveryEntryStatus,
  removeExactQuarantine,
  requireExactEvidence,
  restoreQuarantinedEntryNoReplace,
} from "./quarantine.js";

/** A leaf that disappears before its quarantine needs no removal; any other failure is surfaced. */
async function throwUnlessLeafVanished(outcome: QuarantineOutcome, leafPath: string): Promise<void> {
  if (outcome.error === null) return;
  if (hasCode(outcome.error.value, "ENOENT") && !await lstatIfExists(leafPath)) return;
  throw outcome.error.value;
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
    await throwUnlessLeafVanished(quarantine, destinationPath);
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
    await throwUnlessLeafVanished(quarantine, destinationPath);
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
