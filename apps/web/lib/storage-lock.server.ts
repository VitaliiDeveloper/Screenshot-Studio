// SPDX-License-Identifier: Apache-2.0
import { realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { lock as acquireFileLock, type LockOptions } from "proper-lockfile";

type StorageLockOptions = Omit<LockOptions, "lockfilePath" | "realpath">;

/**
 * Acquires a directory lock whose in-process identity is the lock path itself.
 *
 * proper-lockfile tracks owned locks by its `file` argument, not by a custom
 * `lockfilePath`. Reusing one file with several lock paths makes concurrent
 * locks overwrite each other's heartbeat and release state.
 */
export async function acquireStorageLock(
  lockPath: string,
  options: StorageLockOptions,
): Promise<() => Promise<void>> {
  const canonicalParent = await realpath(dirname(lockPath));
  const canonicalLockPath = join(canonicalParent, basename(lockPath));
  return acquireFileLock(canonicalLockPath, {
    ...options,
    lockfilePath: canonicalLockPath,
    realpath: false,
  });
}
