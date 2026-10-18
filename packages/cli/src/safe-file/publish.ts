// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { link, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { SafeFileConflictError } from "./types.js";
import type {
  CapturedError,
  PublicationDependencies,
  SafeFileOwnership,
  SafeFilePublication,
  SafeFilePublicationWithOwnership,
} from "./types.js";
import { hasCode, publicationDestinationError } from "./fs-basics.js";
import {
  assertCanonicalContainment,
  assertPortableRelativePath,
  ensureAncestors,
  inspectRegularLeaf,
  resolveOrCreateRootBoundary,
  revalidateAncestors,
} from "./paths.js";
import {
  destinationMatches,
  reconcileHardLinkPublication,
  reconcileRenamePublication,
  requireCommittedDestination,
  requireOwnedStage,
} from "./evidence.js";
import { createOwnedStage, removeOwnedStage } from "./stage.js";

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
