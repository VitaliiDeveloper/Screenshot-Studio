// SPDX-License-Identifier: Apache-2.0
import { lock as acquireFileLock, type LockOptions } from "proper-lockfile";
import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_STALE_AFTER_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 50;
const DEFAULT_HEARTBEAT_MS = 10_000;
const MINIMUM_STALE_AFTER_MS = 5_000;
const MINIMUM_HEARTBEAT_MS = 1_000;

export interface ProjectLockOptions {
  /** Maximum time spent waiting for another local writer. Zero makes one immediate attempt. */
  timeoutMs?: number;
  /** Age after which an unrefreshed lock may be recovered following a process crash. */
  staleAfterMs?: number;
  /** Constant delay between acquisition attempts. */
  retryDelayMs?: number;
  /** Interval used to refresh the active lock lease. */
  heartbeatMs?: number;
}

export interface ProjectMutationLock {
  /** Releases the lease. Repeated or concurrent calls share one cleanup operation. */
  release(): Promise<void>;
}

interface NormalizedProjectLockOptions {
  timeoutMs: number;
  staleAfterMs: number;
  retryDelayMs: number;
  heartbeatMs: number;
}

function checkedDuration(value: number, name: keyof ProjectLockOptions, minimum: number): number {
  if (!Number.isFinite(value) || value < minimum) {
    throw new RangeError(`${name} must be a finite number greater than or equal to ${minimum}`);
  }
  return value;
}

function normalizeOptions(options: ProjectLockOptions): NormalizedProjectLockOptions {
  const timeoutMs = checkedDuration(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs", 0);
  const staleAfterMs = checkedDuration(
    options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS,
    "staleAfterMs",
    MINIMUM_STALE_AFTER_MS,
  );
  const retryDelayMs = checkedDuration(
    options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    "retryDelayMs",
    1,
  );
  const defaultHeartbeatMs = Math.min(DEFAULT_HEARTBEAT_MS, Math.floor(staleAfterMs / 2));
  const heartbeatMs = checkedDuration(
    options.heartbeatMs ?? defaultHeartbeatMs,
    "heartbeatMs",
    MINIMUM_HEARTBEAT_MS,
  );
  if (heartbeatMs > staleAfterMs / 2) {
    throw new RangeError("heartbeatMs must be less than or equal to staleAfterMs / 2");
  }
  return { timeoutMs, staleAfterMs, retryDelayMs, heartbeatMs };
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function retryOptions(options: NormalizedProjectLockOptions): LockOptions["retries"] {
  const retries = Math.floor(options.timeoutMs / options.retryDelayMs);
  if (retries === 0) return 0;
  return {
    retries,
    factor: 1,
    minTimeout: options.retryDelayMs,
    maxTimeout: options.retryDelayMs,
    randomize: false,
  };
}

function lockPathForCanonicalProject(canonicalProjectPath: string): string {
  return join(
    dirname(canonicalProjectPath),
    `.${basename(canonicalProjectPath)}.screenshot-studio.lock`,
  );
}

export function projectMutationLockPath(projectPath: string): string {
  return lockPathForCanonicalProject(realpathSync(resolve(projectPath)));
}

/**
 * Acquires the local filesystem lease used to serialize complete project read-modify-write
 * transactions. Application code owns this adapter API; `proper-lockfile` remains an implementation
 * detail that can be replaced without changing CLI or editor services.
 */
export async function acquireProjectMutationLock(
  projectPath: string,
  options: ProjectLockOptions = {},
): Promise<ProjectMutationLock> {
  const absoluteProjectPath = resolve(projectPath);
  const normalized = normalizeOptions(options);
  let canonicalProjectPath: string;
  try {
    canonicalProjectPath = realpathSync(absoluteProjectPath);
  } catch (error) {
    throw new Error(`Failed to resolve the project path before locking ${absoluteProjectPath}`, {
      cause: error,
    });
  }
  const lockPath = lockPathForCanonicalProject(canonicalProjectPath);
  let releaseFileLock: () => Promise<void>;

  try {
    releaseFileLock = await acquireFileLock(canonicalProjectPath, {
      lockfilePath: lockPath,
      realpath: false,
      stale: normalized.staleAfterMs,
      update: normalized.heartbeatMs,
      retries: retryOptions(normalized),
      onCompromised(error) {
        // Exclusive ownership is a persistence invariant. Continuing after a compromised heartbeat
        // could let two processes write the same project, so this intentionally remains fail-fast.
        throw error;
      },
    });
  } catch (error) {
    if (errorCode(error) === "ELOCKED") {
      throw new Error(
        `Timed out waiting for the project mutation lock for ${absoluteProjectPath}; another local process may be editing it`,
        { cause: error },
      );
    }
    throw new Error(`Failed to acquire the project mutation lock for ${absoluteProjectPath}`, {
      cause: error,
    });
  }

  let releasePromise: Promise<void> | undefined;
  return {
    release() {
      releasePromise ??= releaseFileLock().catch((error: unknown) => {
        throw new Error(`Failed to release the project mutation lock for ${absoluteProjectPath}`, {
          cause: error,
        });
      });
      return releasePromise;
    },
  };
}

export async function withProjectMutation<T>(
  projectPath: string,
  operation: () => Promise<T>,
  options: ProjectLockOptions = {},
): Promise<T> {
  const lock = await acquireProjectMutationLock(projectPath, options);
  let operationCompleted = false;
  let operationResult: T | undefined;
  let operationError: unknown;

  try {
    operationResult = await operation();
    operationCompleted = true;
  } catch (error) {
    operationError = error;
  }

  try {
    await lock.release();
  } catch (releaseError) {
    if (!operationCompleted) {
      throw new AggregateError(
        [operationError, releaseError],
        `Project mutation and lock release both failed for ${resolve(projectPath)}`,
        { cause: releaseError },
      );
    }
    throw releaseError;
  }

  if (!operationCompleted) throw operationError;
  return operationResult as T;
}
