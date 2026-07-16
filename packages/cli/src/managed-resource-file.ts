// SPDX-License-Identifier: Apache-2.0
import {
  publishFileSafelyWithOwnership,
  quarantineRegularFileSafely,
  removeRegularFileSafely,
  type SafeFileOwnership,
  type SafeFilePublication,
  type SafeFilePublicationWithOwnership,
  type SafeRegularFileQuarantine,
} from "./safe-file-publisher.js";

export type ManagedResourceOwnership = SafeFileOwnership;
export type ManagedResourceFilePublication = SafeFilePublication;
export type ManagedResourcePublication = SafeFilePublicationWithOwnership;
export type ManagedResourceQuarantine = SafeRegularFileQuarantine;
export { SafeFileConflictError as ManagedResourceConflictError } from "./safe-file-publisher.js";

/** Publishes one managed project resource and returns evidence for fail-closed rollback/removal. */
export function publishManagedResourceFile(
  publication: SafeFilePublication,
): Promise<ManagedResourcePublication> {
  return publishFileSafelyWithOwnership(publication);
}

/** Captures one managed resource for transaction rollback without replacing a later occupant. */
export function quarantineManagedResourceFile(
  root: string,
  relativePath: string,
  expectedOwnership?: ManagedResourceOwnership,
): Promise<ManagedResourceQuarantine | null> {
  return quarantineRegularFileSafely(root, relativePath, expectedOwnership);
}

/** Removes only the managed resource that still matches the caller's ownership evidence. */
export function removeManagedResourceFile(
  root: string,
  relativePath: string,
  expectedOwnership?: ManagedResourceOwnership,
): Promise<boolean> {
  return removeRegularFileSafely(root, relativePath, expectedOwnership);
}
