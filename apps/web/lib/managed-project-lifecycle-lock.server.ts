// SPDX-License-Identifier: Apache-2.0
import { lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LockOptions } from "proper-lockfile";
import type { ManagedProjectStorageConfig } from "./managed-project-config.server.js";
import { acquireStorageLock } from "./storage-lock.server.js";
import { errorCode } from "@screenshot-studio/core/storage";

const PROJECT_ID_PATTERN = /^project_[0-9a-f]{32}$/;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_STALE_AFTER_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 50;
const DEFAULT_HEARTBEAT_MS = 10_000;

export interface ManagedProjectLifecycleLockOptions {
  timeoutMs?: number;
  staleAfterMs?: number;
  retryDelayMs?: number;
  heartbeatMs?: number;
}

export interface ManagedProjectLifecycleLock {
  readonly projectId: string;
  release(): Promise<void>;
}

const activeLifecycleLocks = new WeakMap<
  ManagedProjectLifecycleLock,
  { projectId: string; storageRoot: string; lockPath: string }
>();

export function assertManagedProjectLifecycleLockHeld(
  lock: ManagedProjectLifecycleLock,
  config: ManagedProjectStorageConfig,
  projectId: string,
): void {
  requireProjectId(projectId);
  const proof = activeLifecycleLocks.get(lock);
  if (!proof || proof.projectId !== projectId || proof.storageRoot !== config.root
    || proof.lockPath !== managedProjectLifecycleLockPath(config, projectId)
    || lock.projectId !== projectId) {
    throw new Error("Matching managed project lifecycle lock must be held");
  }
}

function requireProjectId(id: string): void {
  if (!PROJECT_ID_PATTERN.test(id)) throw new TypeError("Invalid managed project id");
}

function duration(value: number, property: string, minimum: number): number {
  if (!Number.isFinite(value) || value < minimum) {
    throw new RangeError(`${property} must be a finite number greater than or equal to ${minimum}`);
  }
  return value;
}

function retries(timeoutMs: number, retryDelayMs: number): LockOptions["retries"] {
  const count = Math.floor(timeoutMs / retryDelayMs);
  return count === 0 ? 0 : {
    retries: count,
    factor: 1,
    minTimeout: retryDelayMs,
    maxTimeout: retryDelayMs,
    randomize: false,
  };
}

export async function ensureManagedStorageRoot(config: ManagedProjectStorageConfig): Promise<string> {
  let info;
  try {
    info = await lstat(config.root);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
    await mkdir(config.root, { recursive: true, mode: 0o700 });
    info = await lstat(config.root);
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("Managed storage root must be a real directory");
  }
  return realpath(config.root);
}

export function managedProjectLifecycleLockPath(
  config: ManagedProjectStorageConfig,
  id: string,
): string {
  requireProjectId(id);
  return join(config.lifecycleLocksRoot, `${id}.lock`);
}

export async function validateManagedStorageChildRoot(
  config: ManagedProjectStorageConfig,
  childRoot: string,
): Promise<string> {
  await ensureManagedStorageRoot(config);
  const [managedInfo, childInfo] = await Promise.all([lstat(config.root), lstat(childRoot)]);
  if (!managedInfo.isDirectory() || managedInfo.isSymbolicLink()
    || !childInfo.isDirectory() || childInfo.isSymbolicLink()) {
    throw new Error("Managed storage boundary must be a real directory");
  }
  const [managed, child] = await Promise.all([realpath(config.root), realpath(childRoot)]);
  if (dirname(child) !== managed) {
    throw new Error("Managed storage boundary is outside the configured root");
  }
  return child;
}

export async function acquireManagedProjectLifecycleLock(
  config: ManagedProjectStorageConfig,
  id: string,
  options: ManagedProjectLifecycleLockOptions = {},
): Promise<ManagedProjectLifecycleLock> {
  requireProjectId(id);
  const timeoutMs = duration(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs", 0);
  const staleAfterMs = duration(options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS, "staleAfterMs", 5_000);
  const retryDelayMs = duration(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS, "retryDelayMs", 1);
  const heartbeatMs = duration(
    options.heartbeatMs ?? Math.min(DEFAULT_HEARTBEAT_MS, Math.floor(staleAfterMs / 2)),
    "heartbeatMs",
    1_000,
  );
  if (heartbeatMs > staleAfterMs / 2) throw new RangeError("heartbeatMs must not exceed staleAfterMs / 2");
  await ensureManagedStorageRoot(config);
  await mkdir(config.lifecycleLocksRoot, { recursive: true, mode: 0o700 });
  await validateManagedStorageChildRoot(config, config.lifecycleLocksRoot);
  let releaseFileLock: () => Promise<void>;
  try {
    releaseFileLock = await acquireStorageLock(managedProjectLifecycleLockPath(config, id), {
      stale: staleAfterMs,
      update: heartbeatMs,
      retries: retries(timeoutMs, retryDelayMs),
      onCompromised(error) { throw error; },
    });
  } catch (error) {
    if (errorCode(error) === "ELOCKED") {
      throw new Error(`Timed out waiting for managed project lifecycle lock for ${id}`, { cause: error });
    }
    throw new Error(`Failed to acquire managed project lifecycle lock for ${id}`, { cause: error });
  }
  let releasePromise: Promise<void> | undefined;
  const lock: ManagedProjectLifecycleLock = {
    projectId: id,
    release() {
      if (!releasePromise) activeLifecycleLocks.delete(lock);
      releasePromise ??= releaseFileLock()
        .catch((error: unknown) => {
          throw new Error(`Failed to release managed project lifecycle lock for ${id}`, { cause: error });
        });
      return releasePromise;
    },
  };
  activeLifecycleLocks.set(lock, {
    projectId: id,
    storageRoot: config.root,
    lockPath: managedProjectLifecycleLockPath(config, id),
  });
  return lock;
}

export async function withManagedProjectLifecycleLock<T>(
  config: ManagedProjectStorageConfig,
  id: string,
  operation: (lock: ManagedProjectLifecycleLock) => Promise<T>,
  options: ManagedProjectLifecycleLockOptions = {},
): Promise<T> {
  requireProjectId(id);
  const lease = await acquireManagedProjectLifecycleLock(config, id, options);
  let completed = false;
  let result: T | undefined;
  let operationError: unknown;
  try {
    result = await operation(lease);
    completed = true;
  } catch (error) {
    operationError = error;
  }
  try {
    await lease.release();
  } catch (releaseError) {
    if (!completed) {
      throw new AggregateError(
        [operationError, releaseError],
        "Managed project operation and lifecycle-lock release both failed",
        { cause: releaseError },
      );
    }
    throw releaseError;
  }
  if (!completed) throw operationError;
  return result as T;
}
