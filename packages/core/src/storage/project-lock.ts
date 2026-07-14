// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_STALE_AFTER_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 50;
const DEFAULT_HEARTBEAT_MS = 10_000;
const OWNER_FILENAME = "owner.json";

type HeartbeatCallback = () => Promise<void>;

export interface ProjectLockDependencies {
  now?: () => number;
  randomId?: () => string;
  sleep?: (durationMs: number) => Promise<void>;
  scheduleHeartbeat?: (callback: HeartbeatCallback, intervalMs: number) => () => void;
}

export interface ProjectLockOptions {
  timeoutMs?: number;
  staleAfterMs?: number;
  retryDelayMs?: number;
  heartbeatMs?: number;
  dependencies?: ProjectLockDependencies;
}

export interface ProjectMutationLock {
  ownerToken: string;
  release(): Promise<void>;
}

interface ResolvedLockOptions {
  timeoutMs: number;
  staleAfterMs: number;
  retryDelayMs: number;
  heartbeatMs: number;
  now: () => number;
  randomId: () => string;
  sleep: (durationMs: number) => Promise<void>;
  scheduleHeartbeat: (callback: HeartbeatCallback, intervalMs: number) => () => void;
}

function defaultSleep(durationMs: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, durationMs));
}

function defaultScheduleHeartbeat(callback: HeartbeatCallback, intervalMs: number): () => void {
  const timer = setInterval(() => { void callback().catch(() => undefined); }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

function resolvedOptions(options: ProjectLockOptions): ResolvedLockOptions {
  const dependencies = options.dependencies ?? {};
  return {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    staleAfterMs: options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS,
    retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    heartbeatMs: options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
    now: dependencies.now ?? Date.now,
    randomId: dependencies.randomId ?? randomUUID,
    sleep: dependencies.sleep ?? defaultSleep,
    scheduleHeartbeat: dependencies.scheduleHeartbeat ?? defaultScheduleHeartbeat,
  };
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorsTogether(primary: unknown, cleanup: unknown): AggregateError {
  return new AggregateError(
    [primary, cleanup],
    `${errorText(primary)}; project lock cleanup failed: ${errorText(cleanup)}`,
    { cause: primary },
  );
}

export function projectMutationLockPath(projectPath: string): string {
  const absolute = resolve(projectPath);
  return join(dirname(absolute), `.${basename(absolute)}.screenshot-studio.lock`);
}

function ownerPath(lockPath: string): string {
  return join(lockPath, OWNER_FILENAME);
}

async function readOwnerToken(lockPath: string): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(await readFile(ownerPath(lockPath), "utf8")) as { token?: unknown };
    return typeof parsed.token === "string" ? parsed.token : undefined;
  } catch (error) {
    if (errorCode(error) === "ENOENT" || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

async function refreshOwnedLease(lockPath: string, token: string, now: number): Promise<boolean> {
  if (await readOwnerToken(lockPath) !== token) return false;
  const heartbeat = new Date(now);
  try {
    await utimes(lockPath, heartbeat, heartbeat);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

async function recoverStaleLease(
  lockPath: string,
  options: ResolvedLockOptions,
): Promise<boolean> {
  let observed;
  try {
    observed = await stat(lockPath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return true;
    throw error;
  }
  if (options.now() - observed.mtimeMs <= options.staleAfterMs) return false;

  const quarantinePath = `${lockPath}.stale.${options.randomId()}`;
  try {
    await rename(lockPath, quarantinePath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return true;
    throw error;
  }

  const moved = await stat(quarantinePath);
  if (options.now() - moved.mtimeMs <= options.staleAfterMs) {
    try {
      await rename(quarantinePath, lockPath);
    } catch (restoreError) {
      throw new Error(
        `A live project lock moved during stale recovery and could not be restored: ${lockPath}`,
        { cause: restoreError },
      );
    }
    return false;
  }

  await rm(quarantinePath, { recursive: true, force: true });
  return true;
}

async function releaseOwnedLease(
  lockPath: string,
  token: string,
  randomId: () => string,
): Promise<void> {
  if (await readOwnerToken(lockPath) !== token) return;
  const releasePath = `${lockPath}.release.${randomId()}`;
  try {
    await rename(lockPath, releasePath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }

  if (await readOwnerToken(releasePath) !== token) {
    try {
      await rename(releasePath, lockPath);
    } catch (restoreError) {
      throw new Error(
        `Project lock ownership changed during release and could not be restored: ${lockPath}`,
        { cause: restoreError },
      );
    }
    return;
  }
  await rm(releasePath, { recursive: true, force: true });
}

async function createOwnedLease(
  lockPath: string,
  options: ResolvedLockOptions,
): Promise<ProjectMutationLock | undefined> {
  try {
    await mkdir(lockPath, { mode: 0o700 });
  } catch (error) {
    if (errorCode(error) === "EEXIST") return undefined;
    throw error;
  }

  const ownerToken = options.randomId();
  try {
    await writeFile(ownerPath(lockPath), `${JSON.stringify({ token: ownerToken })}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await refreshOwnedLease(lockPath, ownerToken, options.now());
  } catch (error) {
    await rm(lockPath, { recursive: true, force: true }).catch((cleanupError) => {
      throw errorsTogether(error, cleanupError);
    });
    throw error;
  }

  let cancelHeartbeat: () => void = () => undefined;
  let heartbeatError: unknown;
  const heartbeat = async () => {
    try {
      if (!await refreshOwnedLease(lockPath, ownerToken, options.now())) cancelHeartbeat();
    } catch (error) {
      heartbeatError = error;
      cancelHeartbeat();
    }
  };
  try {
    cancelHeartbeat = options.scheduleHeartbeat(heartbeat, options.heartbeatMs);
  } catch (error) {
    await releaseOwnedLease(lockPath, ownerToken, options.randomId).catch((cleanupError) => {
      throw errorsTogether(error, cleanupError);
    });
    throw error;
  }

  let releasePromise: Promise<void> | undefined;
  return {
    ownerToken,
    release() {
      releasePromise ??= (async () => {
        cancelHeartbeat();
        await releaseOwnedLease(lockPath, ownerToken, options.randomId);
        if (heartbeatError) throw new Error(
          `Project lock heartbeat failed for ${lockPath}: ${errorText(heartbeatError)}`,
          { cause: heartbeatError },
        );
      })();
      return releasePromise;
    },
  };
}

export async function acquireProjectMutationLock(
  projectPath: string,
  options: ProjectLockOptions = {},
): Promise<ProjectMutationLock> {
  const resolved = resolvedOptions(options);
  const lockPath = projectMutationLockPath(projectPath);
  const startedAt = resolved.now();

  while (true) {
    const lock = await createOwnedLease(lockPath, resolved);
    if (lock) return lock;

    if (await recoverStaleLease(lockPath, resolved)) continue;
    if (resolved.now() - startedAt >= resolved.timeoutMs) {
      throw new Error(`Timed out waiting for project lock ${projectPath}; retry after the active mutation finishes`);
    }
    await resolved.sleep(resolved.retryDelayMs);
  }
}

export async function withProjectMutation<T>(
  projectPath: string,
  operation: () => Promise<T>,
  options: ProjectLockOptions = {},
): Promise<T> {
  const lock = await acquireProjectMutationLock(projectPath, options);
  let result: T | undefined;
  let primaryError: unknown;
  try {
    result = await operation();
  } catch (error) {
    primaryError = error;
  }

  try {
    await lock.release();
  } catch (cleanupError) {
    if (primaryError) throw errorsTogether(primaryError, cleanupError);
    throw cleanupError;
  }
  if (primaryError) throw primaryError;
  return result!;
}
