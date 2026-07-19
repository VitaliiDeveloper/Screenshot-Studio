// SPDX-License-Identifier: Apache-2.0
import { lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { lock as acquireFileLock, type LockOptions } from "proper-lockfile";
import type { ManagedProjectStorageConfig } from "./managed-project-config.server.js";

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
  release(): Promise<void>;
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

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    && typeof error.code === "string" ? error.code : undefined;
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
    releaseFileLock = await acquireFileLock(config.lifecycleLocksRoot, {
      lockfilePath: managedProjectLifecycleLockPath(config, id),
      realpath: true,
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
  return {
    release() {
      releasePromise ??= releaseFileLock().catch((error: unknown) => {
        throw new Error(`Failed to release managed project lifecycle lock for ${id}`, { cause: error });
      });
      return releasePromise;
    },
  };
}
