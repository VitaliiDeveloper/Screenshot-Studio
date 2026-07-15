// SPDX-License-Identifier: Apache-2.0
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  link,
  mkdir,
  open,
  readdir,
  readFile as readNodeFile,
  readlink,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { hostname as systemHostname, tmpdir, uptime } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_STALE_AFTER_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 50;
const DEFAULT_HEARTBEAT_MS = 10_000;
const OWNERS_DIRECTORY = "owners";
const RELEASED_DIRECTORY = "released";
const QUEUE_FILENAME = "queue.log";
const LOG_ENTRY_PREFIX = "SSLOCK1:";

type HeartbeatCallback = () => Promise<void>;

export interface ProjectLockOwner {
  token: string;
  hostname: string;
  hostInstanceId: string;
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
  publishFileExclusive(path: string, contents: string, mode: number): Promise<boolean>;
  appendLine(path: string, line: string, mode: number): Promise<void>;
  readFile(path: string): Promise<ProjectLockFile | undefined>;
  listDirectory(path: string): Promise<string[]>;
  touchFile(path: string, mtimeMs: number): Promise<void>;
  removeFile(path: string): Promise<void>;
}

export interface ProjectLockDependencies {
  now?: () => number;
  randomId?: () => string;
  hostname?: () => string;
  hostInstanceId?: () => string | Promise<string>;
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
  hostInstanceId: string;
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

async function writeExclusiveFile(path: string, contents: string, mode: number): Promise<void> {
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
      await writeExclusiveFile(path, contents, mode);
    },
    async publishFileExclusive(path, contents, mode) {
      const stagePath = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
      await writeExclusiveFile(stagePath, contents, mode);
      try {
        await link(stagePath, path);
      } catch (error) {
        try {
          await unlink(stagePath);
        } catch (cleanupError) {
          if (errorCode(cleanupError) !== "ENOENT") {
            throw errorsTogether(error, cleanupError);
          }
        }
        if (errorCode(error) === "EEXIST") return false;
        throw error;
      }
      // The complete inode is now published at `path`; stage cleanup cannot retract that claim.
      await unlink(stagePath).catch(() => undefined);
      return true;
    },
    async appendLine(path, line, mode) {
      if (!line.endsWith("\n") || line.slice(0, -1).includes("\n")) {
        throw new Error("Project lock log entries must be exactly one newline-terminated line");
      }
      const handle = await open(path, noFollowFlags(
        constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | (constants.O_NONBLOCK ?? 0),
      ), mode);
      await useHandle(handle, async () => {
        const entry = await handle.stat();
        if (!entry.isFile()) throw new Error(`Project lock entry is not a regular file: ${path}`);
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
    async listDirectory(path) {
      return readdir(path);
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

let localHostInstancePromise: Promise<string> | undefined;

async function bootSessionIdentity(): Promise<string> {
  if (process.platform === "linux") {
    try {
      const [bootId, pidNamespace] = await Promise.all([
        readNodeFile("/proc/sys/kernel/random/boot_id", "utf8"),
        readlink("/proc/self/ns/pid"),
      ]);
      return `linux:${bootId.trim()}:${pidNamespace}`;
    } catch {
      // Fall through to the portable boot-epoch identity and fail closed on disagreement.
    }
  }
  try {
    const bootEpochMinute = Math.round((Date.now() - uptime() * 1_000) / 60_000);
    return `${process.platform}:uptime:${bootEpochMinute}`;
  } catch {
    try {
      const runtimeDirectory = process.platform === "darwin" ? "/private/var/run" : tmpdir();
      const runtimeState = await lstat(runtimeDirectory);
      const runtimeEpoch = runtimeState.birthtimeMs || runtimeState.mtimeMs;
      return `${process.platform}:runtime:${runtimeEpoch}`;
    } catch {
      // Different processes intentionally disagree when the OS cannot prove one shared boot epoch.
      return `${process.platform}:unknown:${process.pid}:${randomUUID()}`;
    }
  }
}

function validatedHostInstanceId(contents: string, path: string): string {
  const value = contents.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`Invalid local project-lock host identity: ${path}`);
  }
  return value;
}

async function createLocalHostInstanceId(): Promise<string> {
  const bootSession = await bootSessionIdentity();
  const sessionHash = createHash("sha256").update(bootSession).digest("hex").slice(0, 20);
  const userId = process.getuid?.() ?? "user";
  const path = join(tmpdir(), `.screenshot-studio-host-${userId}-${sessionHash}.id`);
  const fileSystem = createNodeProjectLockFileSystem();
  const existing = await fileSystem.readFile(path);
  if (existing) return validatedHostInstanceId(existing.contents, path);

  const identifier = randomUUID();
  try {
    await fileSystem.createFileExclusive(path, `${identifier}\n`, 0o600);
    return identifier;
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
    let lastReadError: unknown = error;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const raced = await fileSystem.readFile(path);
      if (raced) {
        try {
          return validatedHostInstanceId(raced.contents, path);
        } catch (readError) {
          lastReadError = readError;
        }
      }
      await new Promise<void>((resolveWait) => setImmediate(resolveWait));
    }
    throw new AggregateError(
      [error, lastReadError],
      `Local project-lock host identity was not readable after creation: ${path}`,
      { cause: error },
    );
  }
}

function defaultHostInstanceId(): Promise<string> {
  localHostInstancePromise ??= createLocalHostInstanceId().catch((error) => {
    localHostInstancePromise = undefined;
    throw error;
  });
  return localHostInstancePromise;
}

function defaultOwnerLiveness(
  owner: ProjectLockOwner,
  localHostname: string,
  localHostInstanceId: string,
): boolean {
  if (owner.hostname !== localHostname || owner.hostInstanceId !== localHostInstanceId) return true;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    if (errorCode(error) === "ESRCH") return false;
    if (errorCode(error) === "EPERM") return true;
    throw error;
  }
}

async function resolvedOptions(options: ProjectLockOptions): Promise<ResolvedLockOptions> {
  const dependencies = options.dependencies ?? {};
  const localHostname = dependencies.hostname?.() ?? systemHostname();
  const localHostInstanceId = await (dependencies.hostInstanceId?.() ?? defaultHostInstanceId());
  const nodeFileSystem = createNodeProjectLockFileSystem();
  return {
    timeoutMs: checkedDuration(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs", true),
    staleAfterMs: checkedDuration(options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS, "staleAfterMs", true),
    retryDelayMs: checkedDuration(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS, "retryDelayMs", false),
    heartbeatMs: checkedDuration(options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS, "heartbeatMs", false),
    now: dependencies.now ?? Date.now,
    randomId: dependencies.randomId ?? randomUUID,
    hostname: localHostname,
    hostInstanceId: localHostInstanceId,
    processId: dependencies.processId?.() ?? process.pid,
    isOwnerAlive: async (owner) => dependencies.isOwnerAlive
      ? dependencies.isOwnerAlive(owner)
      : defaultOwnerLiveness(owner, localHostname, localHostInstanceId),
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

function releasedPath(lockPath: string): string {
  return join(lockPath, RELEASED_DIRECTORY);
}

function releasedMarkerPath(lockPath: string, token: string): string {
  return join(releasedPath(lockPath), `${encodeURIComponent(token)}.json`);
}

function queuePath(lockPath: string): string {
  return join(lockPath, QUEUE_FILENAME);
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
    || typeof owner.hostInstanceId !== "string"
    || owner.hostInstanceId.length === 0
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

function encodedLogLine(value: QueueEntry): string {
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

function parseReleasedEntry(contents: string, path: string): ReleasedEntry {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Invalid project lock release marker: ${path}`, { cause: error });
  }
  if (!isReleasedEntry(value)) throw new Error(`Invalid project lock release marker: ${path}`);
  return value;
}

function tokenFromRecordFilename(filename: string, directory: string): string | undefined {
  if (!filename.endsWith(".json")) return undefined;
  let token: string;
  try {
    token = decodeURIComponent(filename.slice(0, -".json".length));
  } catch (error) {
    throw new Error(`Invalid project lock record filename: ${join(directory, filename)}`, { cause: error });
  }
  if (`${encodeURIComponent(token)}.json` !== filename || token.length === 0) {
    throw new Error(`Invalid project lock record filename: ${join(directory, filename)}`);
  }
  return token;
}

async function readReleasedTokens(
  lockPath: string,
  options: ResolvedLockOptions,
): Promise<Set<string>> {
  const directory = releasedPath(lockPath);
  const tokens = new Set<string>();
  for (const filename of await options.fileSystem.listDirectory(directory)) {
    const token = tokenFromRecordFilename(filename, directory);
    if (!token) continue;
    const path = join(directory, filename);
    const marker = await options.fileSystem.readFile(path);
    if (!marker) continue;
    if (parseReleasedEntry(marker.contents, path).token !== token) {
      throw new Error(`Project lock release marker does not match its filename: ${path}`);
    }
    tokens.add(token);
  }
  return tokens;
}

async function markReleased(
  lockPath: string,
  token: string,
  options: ResolvedLockOptions,
): Promise<boolean> {
  const entry: ReleasedEntry = { token, releasedAt: options.now() };
  const path = releasedMarkerPath(lockPath, token);
  if (await options.fileSystem.publishFileExclusive(path, `${JSON.stringify(entry)}\n`, 0o600)) {
    return true;
  }
  const existing = await options.fileSystem.readFile(path);
  if (!existing || parseReleasedEntry(existing.contents, path).token !== token) {
    throw new Error(`Project lock release marker does not match token ${token}: ${path}`);
  }
  return false;
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

async function hasBlockingUnqueuedOwner(
  lockPath: string,
  queued: Set<string>,
  released: Set<string>,
  options: ResolvedLockOptions,
): Promise<boolean> {
  const directory = ownersPath(lockPath);
  for (const filename of await options.fileSystem.listDirectory(directory)) {
    const token = tokenFromRecordFilename(filename, directory);
    if (!token || queued.has(token)) continue;
    const path = ownerPath(lockPath, token);
    if (released.has(token)) {
      await options.fileSystem.removeFile(path);
      continue;
    }
    const file = await options.fileSystem.readFile(path);
    if (!file) continue;
    const owner = parseOwner(file.contents, path);
    if (owner.token !== token) throw new Error(`Project lock owner filename does not match token: ${path}`);
    if (options.now() - file.mtimeMs <= options.staleAfterMs) return true;
    if (await options.isOwnerAlive(owner)) return true;

    await markReleased(lockPath, token, options);
    released.add(token);
    await options.fileSystem.removeFile(path);
  }
  return false;
}

async function releaseStaleOwner(
  lockPath: string,
  entry: QueueEntry,
  options: ResolvedLockOptions,
): Promise<boolean> {
  const observed = await readOwner(lockPath, entry, options);
  if (!observed) return false;
  if (options.now() - observed.mtimeMs <= options.staleAfterMs) return false;
  if (await options.isOwnerAlive(observed.owner)) return false;

  await markReleased(lockPath, entry.token, options);
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

  const released = await readReleasedTokens(lockPath, options);
  if (released.has(owner.token)) throw new Error(`Project lock token was released before acquisition: ${owner.token}`);
  if (await hasBlockingUnqueuedOwner(lockPath, seen, released, options)) return false;

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
  await options.fileSystem.ensureDirectory(releasedPath(lockPath), 0o700);

  const owner: ProjectLockOwner = {
    token: options.randomId(),
    hostname: options.hostname,
    hostInstanceId: options.hostInstanceId,
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
    let safeToRemoveOwner = !queueAttempted;
    if (queueAttempted) {
      try {
        await markReleased(lockPath, owner.token, options);
        safeToRemoveOwner = true;
      } catch (releaseError) {
        cleanupFailed = true;
        cleanupError = releaseError;
      }
    }
    if (ownerCreated && safeToRemoveOwner) {
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
    if (heartbeatStopped) return;
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

  let releaseMarked = false;
  let releaseComplete = false;
  let terminalReleaseError: Error | undefined;
  let releasePromise: Promise<void> | undefined;
  const performRelease = async () => {
    closing = true;
    try {
      if (!releaseMarked) {
        await markReleased(lockPath, owner.token, options);
        releaseMarked = true;
        released = true;
      }
      stopHeartbeat();
      await options.fileSystem.removeFile(path);
      releaseComplete = true;
      if (heartbeatFailed) {
        terminalReleaseError = heartbeatFailure(lockPath, heartbeatError);
        throw terminalReleaseError;
      }
    } catch (error) {
      stopHeartbeat();
      if (!releaseComplete) closing = false;
      throw error;
    }
  };
  const release = () => {
    if (releaseComplete) {
      return terminalReleaseError ? Promise.reject(terminalReleaseError) : Promise.resolve();
    }
    releasePromise ??= performRelease().then(
      () => { releasePromise = undefined; },
      (error: unknown) => {
        releasePromise = undefined;
        throw error;
      },
    );
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
  const resolved = await resolvedOptions(options);
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
