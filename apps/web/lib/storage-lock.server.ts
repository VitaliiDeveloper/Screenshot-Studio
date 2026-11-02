// SPDX-License-Identifier: Apache-2.0
import { realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { errorCode } from "@screenshot-studio/core/storage";
import { lock as acquireFileLock, type LockOptions } from "proper-lockfile";

type StorageLockOptions = Omit<LockOptions, "lockfilePath" | "realpath" | "retries"> & {
  timeoutMs: number;
  retryDelayMs: number;
};

export class StorageLockTimeoutError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StorageLockTimeoutError";
  }
}

const ATTEMPT_QUEUES_GLOBAL_KEY = Symbol.for("screenshot-studio.storage-lock-attempts");

function attemptQueues(): Map<string, Promise<void>> {
  const serverGlobal = globalThis as typeof globalThis & { [key: symbol]: unknown };
  serverGlobal[ATTEMPT_QUEUES_GLOBAL_KEY] ??= new Map<string, Promise<void>>();
  return serverGlobal[ATTEMPT_QUEUES_GLOBAL_KEY] as Map<string, Promise<void>>;
}

/**
 * Breaking a stale lock is stat, rmdir, mkdir, so overlapping attempts could delete each other's
 * fresh lock. Only single attempts queue: the retry delay and the holder's work stay outside.
 */
function inAttemptQueue<T>(lockPath: string, attempt: () => Promise<T>): Promise<T> {
  const queues = attemptQueues();
  const result = (queues.get(lockPath) ?? Promise.resolve()).then(attempt);
  const settled = result.then(() => undefined, () => undefined);
  queues.set(lockPath, settled);
  void settled.then(() => {
    if (queues.get(lockPath) === settled) queues.delete(lockPath);
  });
  return result;
}

/**
 * Acquires a directory lock whose in-process identity is the lock path itself.
 *
 * proper-lockfile tracks owned locks by its `file` argument, not by a custom
 * `lockfilePath`. Reusing one file with several lock paths makes concurrent
 * locks overwrite each other's heartbeat and release state.
 */
export async function acquireStorageLock(
  lockPath: string,
  { timeoutMs, retryDelayMs, ...options }: StorageLockOptions,
): Promise<() => Promise<void>> {
  const canonicalParent = await realpath(dirname(lockPath));
  const canonicalLockPath = join(canonicalParent, basename(lockPath));
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      return await inAttemptQueue(canonicalLockPath, () => acquireFileLock(canonicalLockPath, {
        ...options,
        lockfilePath: canonicalLockPath,
        realpath: false,
        retries: 0,
      }));
    } catch (error) {
      if (Date.now() + retryDelayMs > deadline) {
        throw errorCode(error) === "ELOCKED"
          ? new StorageLockTimeoutError(`Timed out waiting for storage lock ${canonicalLockPath}`, { cause: error })
          : error;
      }
      await delay(retryDelayMs);
    }
  }
}
