// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, lstat, open, unlink, type FileHandle } from "node:fs/promises";
import { hostname as systemHostname } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_STALE_AFTER_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 50;
const DEFAULT_HEARTBEAT_MS = 10_000;
const OWNERS_DIRECTORY = "owners";
const QUEUE_FILENAME = "queue.log";
const RELEASED_FILENAME = "released.log";
const LOG_ENTRY_PREFIX = "SSLOCK1:";

type HeartbeatCallback = () => Promise<void>;

export interface ProjectLockOwner {
  token: string;
  hostname: string;
  pid: number;
  createdAt: number;
}

export interface ProjectLockFile {
  contents: string;
  mtimeMs: number;
}

export interface ProjectLockFileSystem {
  ensureDirectory(path: string, mode: number): Promise<void>;
  createFileExclusive(path: string, contents: string, mode: number): Promise<void>;
  appendLine(path: string, line: string, mode: number): Promise<void>;
  readFile(path: string): Promise<ProjectLockFile | undefined>;
  touchFile(path: string, mtimeMs: number): Promise<void>;
  removeFile(path: string): Promise<void>;
}

export interface ProjectLockDependencies {
  now?: () => number;
  randomId?: () => string;
  hostname?: () => string;
  processId?: () => number;
  isOwnerAlive?: (owner: ProjectLockOwner) => boolean | Promise<boolean>;
  sleep?: (durationMs: number) => Promise<void>;
  scheduleHeartbeat?: (callback: HeartbeatCallback, intervalMs: number) => () => void;
  fileSystem?: Partial<ProjectLockFileSystem>;
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

interface QueueEntry {
  token: string;
  createdAt: number;
}

interface ReleasedEntry {
  token: string;
  releasedAt: number;
}

interface ResolvedLockOptions {
  timeoutMs: number;
  staleAfterMs: number;
  retryDelayMs: number;
  heartbeatMs: number;
  now: () => number;
  randomId: () => string;
  hostname: string;
  processId: number;
  isOwnerAlive: (owner: ProjectLockOwner) => Promise<boolean>;
  sleep: (durationMs: number) => Promise<void>;
  scheduleHeartbeat: (callback: HeartbeatCallback, intervalMs: number) => () => void;
  fileSystem: ProjectLockFileSystem;
}

interface ProjectLockTicket extends ProjectMutationLock {
  owner: ProjectLockOwner;
  heartbeatFailure(): Error | undefined;
}

function defaultSleep(durationMs: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, durationMs));
}

function defaultScheduleHeartbeat(callback: HeartbeatCallback, intervalMs: number): () => void {
  const timer = setInterval(() => { void callback().catch(() => undefined); }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
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

async function useHandle<T>(handle: FileHandle, operation: () => Promise<T>): Promise<T> {
  let result!: T;
  let operationFailed = false;
  let operationError: unknown;
  try {
    result = await operation();
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }

  try {
    await handle.close();
  } catch (closeError) {
    if (operationFailed) throw errorsTogether(operationError, closeError);
    throw closeError;
  }
  if (operationFailed) throw operationError;
  return result;
}

function noFollowFlags(flags: number): number {
  return flags | (constants.O_NOFOLLOW ?? 0);
}

async function assertDirectory(path: string): Promise<void> {
  const entry = await lstat(path);
  if (!entry.isDirectory()) {
    throw new Error(`Project lock path is not a directory: ${path}`);
  }
}

export function createNodeProjectLockFileSystem(): ProjectLockFileSystem {
  return {
    async ensureDirectory(path, mode) {
      try {
        await mkdir(path, { mode });
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
      }
      await assertDirectory(path);
    },
    async createFileExclusive(path, contents, mode) {
      const handle = await open(path, noFollowFlags(
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      ), mode);
      let failed = false;
      let primaryError: unknown;
      try {
        await useHandle(handle, async () => {
          await handle.writeFile(contents, "utf8");
          await handle.sync();
        });
      } catch (error) {
        failed = true;
        primaryError = error;
      }
      if (!failed) return;
      try {
        await unlink(path);
      } catch (cleanupError) {
        if (errorCode(cleanupError) !== "ENOENT") {
          throw errorsTogether(primaryError, cleanupError);
        }
      }
      throw primaryError;
    },
    async appendLine(path, line, mode) {
      if (!line.endsWith("\n") || line.slice(0, -1).includes("\n")) {
        throw new Error("Project lock log entries must be exactly one newline-terminated line");
      }
      const handle = await open(path, noFollowFlags(
        constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND,
      ), mode);
      await useHandle(handle, async () => {
        const bytes = Buffer.from(line, "utf8");
        const { bytesWritten } = await handle.write(bytes, 0, bytes.length, null);
        if (bytesWritten !== bytes.length) {
          throw new Error(`Incomplete project lock log append: wrote ${bytesWritten} of ${bytes.length} bytes`);
        }
        await handle.sync();
      });
    },
    async readFile(path) {
      let handle: FileHandle;
      try {
        handle = await open(path, noFollowFlags(constants.O_RDONLY));
      } catch (error) {
        if (errorCode(error) === "ENOENT") return undefined;
        throw error;
      }
      return useHandle(handle, async () => {
        const entry = await handle.stat();
        if (!entry.isFile()) throw new Error(`Project lock entry is not a regular file: ${path}`);
        return { contents: await handle.readFile("utf8"), mtimeMs: entry.mtimeMs };
      });
    },
    async touchFile(path, mtimeMs) {
      const handle = await open(path, noFollowFlags(constants.O_WRONLY));
      await useHandle(handle, async () => {
        const entry = await handle.stat();
        if (!entry.isFile()) throw new Error(`Project lock entry is not a regular file: ${path}`);
        const heartbeat = new Date(mtimeMs);
        await handle.utimes(heartbeat, heartbeat);
      });
    },
    async removeFile(path) {
      try {
        await unlink(path);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
      }
    },
  };
}

function checkedDuration(value: number, name: string, allowZero: boolean): number {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new Error(`${name} must be ${allowZero ? "a non-negative" : "a positive"} finite number`);
  }
  return value;
}

function defaultOwnerLiveness(owner: ProjectLockOwner, localHostname: string): boolean {
  if (owner.hostname !== localHostname) return true;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    if (errorCode(error) === "ESRCH") return false;
    if (errorCode(error) === "EPERM") return true;
    throw error;
  }
}

function resolvedOptions(options: ProjectLockOptions): ResolvedLockOptions {
  const dependencies = options.dependencies ?? {};
  const localHostname = dependencies.hostname?.() ?? systemHostname();
  const nodeFileSystem = createNodeProjectLockFileSystem();
  return {
    timeoutMs: checkedDuration(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs", true),
    staleAfterMs: checkedDuration(options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS, "staleAfterMs", true),
    retryDelayMs: checkedDuration(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS, "retryDelayMs", false),
    heartbeatMs: checkedDuration(options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS, "heartbeatMs", false),
    now: dependencies.now ?? Date.now,
    randomId: dependencies.randomId ?? randomUUID,
    hostname: localHostname,
    processId: dependencies.processId?.() ?? process.pid,
    isOwnerAlive: async (owner) => dependencies.isOwnerAlive
      ? dependencies.isOwnerAlive(owner)
      : defaultOwnerLiveness(owner, localHostname),
    sleep: dependencies.sleep ?? defaultSleep,
    scheduleHeartbeat: dependencies.scheduleHeartbeat ?? defaultScheduleHeartbeat,
    fileSystem: { ...nodeFileSystem, ...dependencies.fileSystem },
  };
}

export function projectMutationLockPath(projectPath: string): string {
  const absolute = resolve(projectPath);
  return join(dirname(absolute), `.${basename(absolute)}.screenshot-studio.lock`);
}

function ownersPath(lockPath: string): string {
  return join(lockPath, OWNERS_DIRECTORY);
}

function ownerPath(lockPath: string, token: string): string {
  return join(ownersPath(lockPath), `${encodeURIComponent(token)}.json`);
}

function queuePath(lockPath: string): string {
  return join(lockPath, QUEUE_FILENAME);
}

function releasedPath(lockPath: string): string {
  return join(lockPath, RELEASED_FILENAME);
}

function parseOwner(contents: string, path: string): ProjectLockOwner {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Invalid project lock owner record: ${path}`, { cause: error });
  }
  const owner = value as Partial<ProjectLockOwner> | null;
  if (!owner
    || typeof owner.token !== "string"
    || owner.token.length === 0
    || typeof owner.hostname !== "string"
    || owner.hostname.length === 0
    || !Number.isInteger(owner.pid)
    || (owner.pid ?? 0) <= 0
    || typeof owner.createdAt !== "number"
    || !Number.isFinite(owner.createdAt)) {
    throw new Error(`Invalid project lock owner record: ${path}`);
  }
  return owner as ProjectLockOwner;
}

function completeLogLines(contents: string): string[] {
  const lines = contents.split("\n");
  if (contents.endsWith("\n")) lines.pop();
  else lines.pop(); // Ignore only a possibly partial final append after a crash.
  return lines;
}

function encodedLogLine(value: QueueEntry | ReleasedEntry): string {
  const payload = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${LOG_ENTRY_PREFIX}${payload}\n`;
}

function parseLog<T>(
  file: ProjectLockFile | undefined,
  path: string,
  validate: (value: unknown) => value is T,
): T[] {
  if (!file) return [];
  return completeLogLines(file.contents).map((line) => {
    if (line.length === 0) throw new Error(`Invalid blank project lock log entry: ${path}`);
    const marker = line.lastIndexOf(LOG_ENTRY_PREFIX);
    if (marker < 0) throw new Error(`Invalid project lock log entry: ${path}`);
    const encoded = line.slice(marker + LOG_ENTRY_PREFIX.length);
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
      throw new Error(`Invalid project lock log entry: ${path}`);
    }
    let value: unknown;
    try {
      value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch (error) {
      throw new Error(`Invalid project lock log entry: ${path}`, { cause: error });
    }
    if (!validate(value)) throw new Error(`Invalid project lock log entry: ${path}`);
    return value;
  });
}

function isQueueEntry(value: unknown): value is QueueEntry {
  const entry = value as Partial<QueueEntry> | null;
  return Boolean(entry
    && typeof entry.token === "string"
    && entry.token.length > 0
    && typeof entry.createdAt === "number"
    && Number.isFinite(entry.createdAt));
}

function isReleasedEntry(value: unknown): value is ReleasedEntry {
  const entry = value as Partial<ReleasedEntry> | null;
  return Boolean(entry
    && typeof entry.token === "string"
    && entry.token.length > 0
    && typeof entry.releasedAt === "number"
    && Number.isFinite(entry.releasedAt));
}

async function appendReleasedToken(
  lockPath: string,
  token: string,
  options: ResolvedLockOptions,
): Promise<void> {
  const entry: ReleasedEntry = { token, releasedAt: options.now() };
  await options.fileSystem.appendLine(releasedPath(lockPath), encodedLogLine(entry), 0o600);
}

async function readOwner(
  lockPath: string,
  expected: QueueEntry,
  options: ResolvedLockOptions,
): Promise<{ owner: ProjectLockOwner; mtimeMs: number } | undefined> {
  const path = ownerPath(lockPath, expected.token);
  const file = await options.fileSystem.readFile(path);
  if (!file) return undefined;
  const owner = parseOwner(file.contents, path);
  if (owner.token !== expected.token || owner.createdAt !== expected.createdAt) {
    throw new Error(`Project lock owner does not match its queue entry: ${path}`);
  }
  return { owner, mtimeMs: file.mtimeMs };
}

async function releaseStaleOwner(
  lockPath: string,
  entry: QueueEntry,
  options: ResolvedLockOptions,
): Promise<boolean> {
  const observed = await readOwner(lockPath, entry, options);
  const heartbeatAt = observed?.mtimeMs ?? entry.createdAt;
  if (options.now() - heartbeatAt <= options.staleAfterMs) return false;
  if (observed && await options.isOwnerAlive(observed.owner)) return false;

  await appendReleasedToken(lockPath, entry.token, options);
  await options.fileSystem.removeFile(ownerPath(lockPath, entry.token));
  return true;
}

async function ownsQueueHead(
  lockPath: string,
  owner: ProjectLockOwner,
  options: ResolvedLockOptions,
): Promise<boolean> {
  const queue = parseLog(
    await options.fileSystem.readFile(queuePath(lockPath)),
    queuePath(lockPath),
    isQueueEntry,
  );
  const seen = new Set<string>();
  for (const entry of queue) {
    if (seen.has(entry.token)) throw new Error(`Duplicate project lock queue token: ${entry.token}`);
    seen.add(entry.token);
  }
  const ownIndex = queue.findIndex((entry) => entry.token === owner.token);
  if (ownIndex < 0) throw new Error(`Project lock queue lost owner token ${owner.token}`);

  const released = new Set(parseLog(
    await options.fileSystem.readFile(releasedPath(lockPath)),
    releasedPath(lockPath),
    isReleasedEntry,
  ).map((entry) => entry.token));
  if (released.has(owner.token)) throw new Error(`Project lock token was released before acquisition: ${owner.token}`);

  for (const entry of queue.slice(0, ownIndex + 1)) {
    if (released.has(entry.token)) continue;
    if (entry.token === owner.token) return true;
    if (await releaseStaleOwner(lockPath, entry, options)) {
      released.add(entry.token);
      continue;
    }
    return false;
  }
  return false;
}

function heartbeatFailure(lockPath: string, failure: unknown): Error {
  return new Error(`Project lock heartbeat failed for ${lockPath}: ${errorText(failure)}`, { cause: failure });
}

async function createTicket(
  lockPath: string,
  options: ResolvedLockOptions,
): Promise<ProjectLockTicket> {
  await options.fileSystem.ensureDirectory(lockPath, 0o700);
  await options.fileSystem.ensureDirectory(ownersPath(lockPath), 0o700);

  const owner: ProjectLockOwner = {
    token: options.randomId(),
    hostname: options.hostname,
    pid: options.processId,
    createdAt: options.now(),
  };
  const path = ownerPath(lockPath, owner.token);
  let ownerCreated = false;
  let queueAttempted = false;
  try {
    await options.fileSystem.createFileExclusive(path, `${JSON.stringify(owner)}\n`, 0o600);
    ownerCreated = true;
    await options.fileSystem.touchFile(path, owner.createdAt);
    queueAttempted = true;
    const entry: QueueEntry = { token: owner.token, createdAt: owner.createdAt };
    await options.fileSystem.appendLine(queuePath(lockPath), encodedLogLine(entry), 0o600);
  } catch (error) {
    let cleanupFailed = false;
    let cleanupError: unknown;
    if (queueAttempted) {
      try {
        await appendReleasedToken(lockPath, owner.token, options);
      } catch (releaseError) {
        cleanupFailed = true;
        cleanupError = releaseError;
      }
    }
    if (ownerCreated) {
      try {
        await options.fileSystem.removeFile(path);
      } catch (removeError) {
        cleanupError = cleanupFailed ? errorsTogether(cleanupError, removeError) : removeError;
        cleanupFailed = true;
      }
    }
    if (cleanupFailed) throw errorsTogether(error, cleanupError);
    throw error;
  }

  let cancelHeartbeat: () => void = () => undefined;
  let heartbeatStopped = false;
  let heartbeatFailed = false;
  let heartbeatError: unknown;
  let closing = false;
  let released = false;
  const stopHeartbeat = () => {
    heartbeatStopped = true;
    cancelHeartbeat();
  };
  const heartbeat = async () => {
    if (closing || released || heartbeatStopped) return;
    try {
      const observed = await options.fileSystem.readFile(path);
      const observedOwner = observed ? parseOwner(observed.contents, path) : undefined;
      if (!observedOwner
        || observedOwner.token !== owner.token
        || observedOwner.createdAt !== owner.createdAt) {
        throw new Error(`Project lock owner record disappeared: ${path}`);
      }
      await options.fileSystem.touchFile(path, options.now());
    } catch (error) {
      if (closing || released) return;
      heartbeatFailed = true;
      heartbeatError = error;
      stopHeartbeat();
    }
  };

  let releasePromise: Promise<void> | undefined;
  const release = () => {
    releasePromise ??= (async () => {
      closing = true;
      try {
        await appendReleasedToken(lockPath, owner.token, options);
      } catch (error) {
        closing = false;
        throw error;
      }
      released = true;
      stopHeartbeat();

      let removeFailed = false;
      let removeError: unknown;
      try {
        await options.fileSystem.removeFile(path);
      } catch (error) {
        removeFailed = true;
        removeError = error;
      }
      if (heartbeatFailed) {
        const failure = heartbeatFailure(lockPath, heartbeatError);
        if (removeFailed) throw errorsTogether(failure, removeError);
        throw failure;
      }
      if (removeFailed) throw removeError;
    })();
    return releasePromise;
  };

  try {
    const scheduledCancel = options.scheduleHeartbeat(heartbeat, options.heartbeatMs);
    cancelHeartbeat = scheduledCancel;
    if (heartbeatStopped) scheduledCancel();
  } catch (error) {
    try {
      await release();
    } catch (cleanupError) {
      throw errorsTogether(error, cleanupError);
    }
    throw error;
  }

  return {
    owner,
    ownerToken: owner.token,
    release,
    heartbeatFailure: () => heartbeatFailed ? heartbeatFailure(lockPath, heartbeatError) : undefined,
  };
}

function timeoutError(projectPath: string, lockPath: string): Error {
  return new Error(
    `Timed out waiting for project lock ${projectPath}; retry after the active mutation finishes. `
    + `If no mutation is running, inspect ${lockPath} before manual recovery`,
  );
}

export async function acquireProjectMutationLock(
  projectPath: string,
  options: ProjectLockOptions = {},
): Promise<ProjectMutationLock> {
  const resolved = resolvedOptions(options);
  const lockPath = projectMutationLockPath(projectPath);
  const startedAt = resolved.now();
  const deadline = startedAt + resolved.timeoutMs;
  const ticket = await createTicket(lockPath, resolved);
  let firstEvaluation = true;
  let acquisitionError: unknown;

  try {
    while (true) {
      const heartbeatError = ticket.heartbeatFailure();
      if (heartbeatError) throw heartbeatError;
      if (!firstEvaluation && resolved.now() >= deadline) throw timeoutError(projectPath, lockPath);
      firstEvaluation = false;

      if (await ownsQueueHead(lockPath, ticket.owner, resolved)) return ticket;

      const remainingMs = deadline - resolved.now();
      if (remainingMs <= 0) throw timeoutError(projectPath, lockPath);
      await resolved.sleep(Math.min(resolved.retryDelayMs, remainingMs));
    }
  } catch (error) {
    acquisitionError = error;
  }

  try {
    await ticket.release();
  } catch (cleanupError) {
    throw errorsTogether(acquisitionError, cleanupError);
  }
  throw acquisitionError;
}

export async function withProjectMutation<T>(
  projectPath: string,
  operation: () => Promise<T>,
  options: ProjectLockOptions = {},
): Promise<T> {
  const lock = await acquireProjectMutationLock(projectPath, options);
  let result!: T;
  let operationFailed = false;
  let operationError: unknown;
  try {
    result = await operation();
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }

  try {
    await lock.release();
  } catch (cleanupError) {
    if (operationFailed) throw errorsTogether(operationError, cleanupError);
    throw cleanupError;
  }
  if (operationFailed) throw operationError;
  return result;
}
