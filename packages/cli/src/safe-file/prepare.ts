// SPDX-License-Identifier: Apache-2.0
import { constants } from "node:fs";
import { link, open, rename, unlink, type FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { SafeFileConflictError } from "./types.js";
import type {
  DeterministicRemovalDependencies,
  FilePublicationDestinationState,
  PreparedPublicationDependencies,
  PreparedSafeFilePublication,
  PublicationInspectionDependencies,
  SafeFileOwnership,
  SafeFilePublication,
} from "./types.js";
import { hasCode, lstatIfExists, publicationDestinationError } from "./fs-basics.js";
import {
  assertCanonicalContainment,
  assertPortableRelativePath,
  ensureAncestors,
  inspectRegularLeaf,
  preparedFileStagePaths,
  resolveOrCreateRootBoundary,
  resolveRootBoundaryIfExists,
  revalidateAncestors,
} from "./paths.js";
import {
  destinationMatches,
  inspectBoundedDestinationBytes,
  ownershipFromEvidence,
  ownershipMatchesEvidence,
  readBoundRegularFileEvidence,
  requireOwnedStage,
} from "./evidence.js";
import { removeExactQuarantine } from "./quarantine.js";
import { createOwnedStage } from "./stage.js";

function directorySyncUnsupported(error: unknown): boolean {
  return ["EBADF", "EINVAL", "ENOTSUP", "EOPNOTSUPP"].some((code) => hasCode(error, code));
}
async function defaultSyncDirectory(
  directory: string,
  openDirectory: NonNullable<PreparedPublicationDependencies["openDirectory"]> = (
    path,
  ) => open(path, constants.O_RDONLY),
): Promise<void> {
  let handle: Pick<FileHandle, "sync" | "close"> | undefined;
  try {
    handle = await openDirectory(directory);
    await handle.sync();
  } catch (error) {
    if (!directorySyncUnsupported(error)) throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
export async function prepareFilePublication(
  options: SafeFilePublication & { stageToken: string },
  dependencies: PreparedPublicationDependencies = {},
): Promise<PreparedSafeFilePublication> {
  if (options.replace) throw new Error("Prepared publication supports create-only resources");
  const { stageRelativePath, stageCleanupRelativePath } = preparedFileStagePaths(
    options.relativePath,
    options.stageToken,
  );
  const boundary = await resolveOrCreateRootBoundary(options.root);
  const segments = options.relativePath.split("/");
  const destinationPath = join(boundary.canonicalRoot, ...segments);
  assertCanonicalContainment(boundary.canonicalRoot, destinationPath);
  const ancestors = await ensureAncestors(boundary, segments.slice(0, -1), true);
  if (!ancestors) throw new Error("Publication ancestor creation failed");
  const openVerification = dependencies.openVerification
    ?? ((path: string, flags: number) => open(path, flags));
  const existing = await destinationMatches(destinationPath, options.bytes, openVerification);
  if (existing) {
    const ownership = ownershipFromEvidence(existing);
    return {
      path: destinationPath,
      stagePath: null,
      created: false,
      ownership,
      async commit() { return { path: destinationPath, created: false, ownership }; },
      async discard() { /* No owned stage exists. */ },
    };
  }
  if (await inspectRegularLeaf(destinationPath, publicationDestinationError)) {
    throw new SafeFileConflictError(destinationPath);
  }

  const stageName = basename(stageRelativePath);
  const stagePath = join(dirname(destinationPath), stageName);
  const revalidate = () => revalidateAncestors(boundary, ancestors);
  const ownership = await createOwnedStage(
    stagePath,
    options.bytes,
    (path, flags, mode) => open(path, flags, mode),
    unlink,
    rename,
    link,
    openVerification,
    revalidate,
  );
  let settled = false;
  const syncDirectory = dependencies.syncDirectory
    ?? ((directory) => defaultSyncDirectory(directory, dependencies.openDirectory));
  return {
    path: destinationPath,
    stagePath,
    created: true,
    ownership,
    async commit() {
      if (settled) throw new Error("Prepared publication capability was already consumed");
      await revalidate();
      await requireOwnedStage(stagePath, ownership, openVerification);
      try {
        await (dependencies.linkFile ?? link)(stagePath, destinationPath);
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
        const collision = await destinationMatches(destinationPath, options.bytes, openVerification);
        if (!collision) throw new SafeFileConflictError(destinationPath);
        const linkCommitted = ownershipMatchesEvidence(ownership, collision);
        if (linkCommitted) await syncDirectory(dirname(destinationPath));
        await removeFileWithDeterministicQuarantine(
          boundary.canonicalRoot,
          stageRelativePath,
          stageCleanupRelativePath,
          ownership,
          { syncDirectory },
        );
        await syncDirectory(dirname(stagePath));
        settled = true;
        return {
          path: destinationPath,
          created: linkCommitted,
          ownership: ownershipFromEvidence(collision),
        };
      }
      await syncDirectory(dirname(destinationPath));
      const removed = await removeFileWithDeterministicQuarantine(
        boundary.canonicalRoot,
        stageRelativePath,
        stageCleanupRelativePath,
        ownership,
        { syncDirectory },
      );
      if (!removed) throw new Error(`Prepared publication stage disappeared: ${stagePath}`);
      await syncDirectory(dirname(destinationPath));
      settled = true;
      return { path: destinationPath, created: true, ownership };
    },
    async discard() {
      if (settled) return;
      const removed = await removeFileWithDeterministicQuarantine(
        boundary.canonicalRoot,
        stageRelativePath,
        stageCleanupRelativePath,
        ownership,
        { syncDirectory },
      );
      if (!removed) throw new Error(`Prepared publication stage disappeared: ${stagePath}`);
      await syncDirectory(dirname(stagePath));
      settled = true;
    },
  };
}
/** Inspect one create-only destination through the same canonical, no-follow boundary as publish. */
export async function inspectFilePublicationDestination(
  options: SafeFilePublication,
  dependencies: PublicationInspectionDependencies = {},
): Promise<FilePublicationDestinationState> {
  if (options.replace) throw new Error("Destination inspection supports create-only resources");
  assertPortableRelativePath(options.relativePath);
  const boundary = await resolveRootBoundaryIfExists(options.root);
  if (!boundary) return "missing";
  const segments = options.relativePath.split("/");
  const destinationPath = join(boundary.canonicalRoot, ...segments);
  assertCanonicalContainment(boundary.canonicalRoot, destinationPath);
  const ancestors = await ensureAncestors(boundary, segments.slice(0, -1), false);
  if (!ancestors) return "missing";
  await revalidateAncestors(boundary, ancestors);
  const openVerification = dependencies.openVerification
    ?? ((path: string, flags: number) => open(path, flags));
  return (await inspectBoundedDestinationBytes(destinationPath, options.bytes, openVerification)).state;
}
export async function removeFileWithDeterministicQuarantine(
  root: string,
  relativePath: string,
  quarantineRelativePath: string,
  expectedOwnership: SafeFileOwnership,
  dependencies: DeterministicRemovalDependencies = {},
): Promise<boolean> {
  assertPortableRelativePath(relativePath);
  assertPortableRelativePath(quarantineRelativePath);
  if (dirname(relativePath) !== dirname(quarantineRelativePath) || relativePath === quarantineRelativePath) {
    throw new TypeError("Deterministic quarantine must be a distinct sibling path");
  }
  const boundary = await resolveRootBoundaryIfExists(root);
  if (!boundary) return false;
  const segments = relativePath.split("/");
  const quarantineSegments = quarantineRelativePath.split("/");
  const path = join(boundary.canonicalRoot, ...segments);
  const quarantinePath = join(boundary.canonicalRoot, ...quarantineSegments);
  const ancestors = await ensureAncestors(boundary, segments.slice(0, -1), false);
  if (!ancestors) return false;
  const revalidate = () => revalidateAncestors(boundary, ancestors);
  const openVerification = (target: string, flags: number) => open(target, flags);
  const syncDirectory = dependencies.syncDirectory
    ?? ((directory) => defaultSyncDirectory(directory));
  let quarantined = await readBoundRegularFileEvidence(
    quarantinePath,
    openVerification,
    "Deterministic removal quarantine changed",
  );
  if (quarantined && !ownershipMatchesEvidence(expectedOwnership, quarantined)) {
    throw new Error(`Deterministic removal quarantine ownership changed: ${quarantinePath}`);
  }
  if (!quarantined) {
    const current = await readBoundRegularFileEvidence(
      path,
      openVerification,
      "Deterministic removal target changed",
    );
    if (!current) return false;
    if (!ownershipMatchesEvidence(expectedOwnership, current)) return false;
    if (await lstatIfExists(quarantinePath)) {
      throw new Error(`Deterministic removal quarantine is occupied: ${quarantinePath}`);
    }
    await revalidate();
    await (dependencies.moveFile ?? rename)(path, quarantinePath);
    await syncDirectory(dirname(path));
    await dependencies.afterQuarantine?.(quarantinePath);
    quarantined = await readBoundRegularFileEvidence(
      quarantinePath,
      openVerification,
      "Deterministic removal quarantine changed after rename",
    );
    if (!quarantined || !ownershipMatchesEvidence(expectedOwnership, quarantined)) {
      throw new Error(`Deterministic removal quarantine ownership changed: ${quarantinePath}`);
    }
  }
  await removeExactQuarantine(
    quarantinePath,
    quarantined,
    dependencies.removeFile ?? unlink,
    openVerification,
    revalidate,
  );
  await syncDirectory(dirname(path));
  return true;
}
