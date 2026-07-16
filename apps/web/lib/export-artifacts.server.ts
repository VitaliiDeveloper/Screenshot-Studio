// SPDX-License-Identifier: Apache-2.0
import { randomBytes as nodeRandomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rm,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_BYTES = 32;
const DEFAULT_TTL_MS = 5 * 60_000;
const DOWNLOAD_FILENAME = "app-store-screenshots-bundle.zip";

interface ArtifactIdentity {
  device: bigint;
  inode: bigint;
  size: bigint;
}

interface ArtifactStat {
  dev: bigint;
  ino: bigint;
  size: bigint;
  nlink: bigint;
  isFile(): boolean;
}

interface ArtifactRecord {
  path: string;
  identity: ArtifactIdentity;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
}

export interface ExportArtifactTicket {
  downloadUrl: string;
  outputDir: string;
  expiresAt: string;
}

export interface ExportArtifact {
  stream: Readable;
  size: bigint;
  filename: string;
  cleanup: Promise<void>;
  dispose(): Promise<void>;
}

export type ExportArtifactLookup =
  | { status: "ready"; artifact: ExportArtifact }
  | { status: "missing" | "expired" | "invalid" };

export interface ExportArtifactStore {
  stage(sourceZipPath: string, outputDir: string): Promise<ExportArtifactTicket>;
  consume(token: string): Promise<ExportArtifactLookup>;
  close(): Promise<void>;
}

export interface ExportArtifactStoreDependencies {
  rootDirectory?: string;
  now?: () => number;
  ttlMs?: number;
  randomBytes?: (size: number) => Buffer;
  unlinkFile?: (path: string) => Promise<void>;
}

function readFlags(): number {
  return constants.O_RDONLY
    | constants.O_NONBLOCK
    | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0);
}

function writeFlags(): number {
  return constants.O_WRONLY
    | constants.O_CREAT
    | constants.O_EXCL
    | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0);
}

function asArtifactStat(value: unknown): ArtifactStat {
  return value as ArtifactStat;
}

function identityOf(stat: ArtifactStat): ArtifactIdentity {
  return { device: stat.dev, inode: stat.ino, size: stat.size };
}

function sameIdentity(left: ArtifactIdentity, right: ArtifactIdentity): boolean {
  return left.device === right.device && left.inode === right.inode && left.size === right.size;
}

function sameBinding(left: ArtifactIdentity, right: ArtifactIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function isExpectedArtifact(stat: ArtifactStat, identity: ArtifactIdentity): boolean {
  return stat.isFile() && stat.nlink === 1n && sameIdentity(identityOf(stat), identity);
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}

async function unlinkExpectedArtifact(
  path: string,
  identity: ArtifactIdentity,
  unlinkFile: (path: string) => Promise<void> = unlink,
): Promise<void> {
  try {
    const current = asArtifactStat(await lstat(path, { bigint: true }));
    if (current.isFile() && sameBinding(identityOf(current), identity)) await unlinkFile(path);
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
}

async function closeHandles(
  handles: FileHandle[],
  primaryError: { value: unknown } | null,
): Promise<void> {
  const closeResults = await Promise.allSettled(handles.map((handle) => handle.close()));
  const closeErrors = closeResults.flatMap((result) => (
    result.status === "rejected" ? [result.reason] : []
  ));
  if (primaryError !== null) {
    if (closeErrors.length > 0) {
      throw new AggregateError([primaryError.value, ...closeErrors], "Artifact staging and cleanup failed", {
        cause: primaryError.value,
      });
    }
    throw primaryError.value;
  }
  if (closeErrors.length === 1) throw closeErrors[0];
  if (closeErrors.length > 1) throw new AggregateError(closeErrors, "Artifact handle cleanup failed");
}

async function copyFileHandles(source: FileHandle, destination: FileHandle): Promise<void> {
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  while (true) {
    const { bytesRead } = await source.read(buffer, 0, buffer.byteLength, position);
    if (bytesRead === 0) return;
    let written = 0;
    while (written < bytesRead) {
      const result = await destination.write(
        buffer,
        written,
        bytesRead - written,
        position + written,
      );
      if (result.bytesWritten === 0) throw new Error("Export artifact staging made no write progress");
      written += result.bytesWritten;
    }
    position += bytesRead;
  }
}

export function createExportArtifactStore(
  dependencies: ExportArtifactStoreDependencies = {},
): ExportArtifactStore {
  const now = dependencies.now ?? Date.now;
  const ttlMs = dependencies.ttlMs ?? DEFAULT_TTL_MS;
  const randomBytes = dependencies.randomBytes ?? nodeRandomBytes;
  const unlinkFile = dependencies.unlinkFile ?? unlink;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new Error("Export artifact TTL must be a positive safe integer");
  }

  const records = new Map<string, ArtifactRecord>();
  const expiredTokens = new Set<string>();
  const tombstoneTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const activeArtifacts = new Set<ExportArtifact>();
  const pendingFileCleanup = new Set<{ path: string; identity: ArtifactIdentity }>();
  const inFlightStages = new Set<Promise<ExportArtifactTicket>>();
  let closed = false;
  let fullyClosed = false;
  let closeInFlight: Promise<void> | undefined;
  let rootPromise: Promise<{ path: string; owned: boolean }> | undefined;
  let pendingCleanupTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingCleanupInFlight: Promise<void> | undefined;

  const cleanupRetryDelayMs = Math.min(ttlMs, 1_000);

  function schedulePendingCleanupRetry(): void {
    if (closed || pendingCleanupTimer || pendingCleanupInFlight || pendingFileCleanup.size === 0) {
      return;
    }
    pendingCleanupTimer = setTimeout(() => {
      pendingCleanupTimer = undefined;
      const attempt = Promise.allSettled(
        [...pendingFileCleanup].map((file) => deleteArtifactFile(file)),
      ).then(() => undefined);
      pendingCleanupInFlight = attempt;
      void attempt.then(() => {
        if (pendingCleanupInFlight === attempt) pendingCleanupInFlight = undefined;
        schedulePendingCleanupRetry();
      });
    }, cleanupRetryDelayMs);
    unrefTimer(pendingCleanupTimer);
  }

  const deleteArtifactFile = async (file: { path: string; identity: ArtifactIdentity }): Promise<void> => {
    try {
      await unlinkExpectedArtifact(file.path, file.identity, unlinkFile);
      pendingFileCleanup.delete(file);
    } catch (error) {
      pendingFileCleanup.add(file);
      schedulePendingCleanupRetry();
      throw error;
    }
  };

  const resolveRoot = (): Promise<{ path: string; owned: boolean }> => {
    rootPromise ??= dependencies.rootDirectory
      ? mkdir(dependencies.rootDirectory, { recursive: true, mode: 0o700 })
          .then(() => ({ path: dependencies.rootDirectory!, owned: false }))
      : mkdtemp(join(tmpdir(), "screenshot-studio-export-artifacts-"))
          .then((path) => ({ path, owned: true }));
    return rootPromise;
  };

  const forgetExpiredTokenLater = (token: string): void => {
    const timer = setTimeout(() => {
      expiredTokens.delete(token);
      tombstoneTimers.delete(token);
    }, ttlMs);
    unrefTimer(timer);
    tombstoneTimers.set(token, timer);
  };

  const expireRecord = async (token: string, expected?: ArtifactRecord): Promise<void> => {
    const record = records.get(token);
    if (!record || (expected && record !== expected)) return;
    const remaining = record.expiresAt - now();
    if (remaining > 0) {
      clearTimeout(record.timer);
      record.timer = setTimeout(() => { void expireRecord(token, record); }, remaining);
      unrefTimer(record.timer);
      return;
    }
    records.delete(token);
    clearTimeout(record.timer);
    expiredTokens.add(token);
    forgetExpiredTokenLater(token);
    await deleteArtifactFile(record).catch(() => undefined);
  };

  const scheduleExpiry = (token: string, record: ArtifactRecord): void => {
    record.timer = setTimeout(() => { void expireRecord(token, record); }, ttlMs);
    unrefTimer(record.timer);
  };

  const stageArtifact = async (
    sourceZipPath: string,
    outputDir: string,
  ): Promise<ExportArtifactTicket> => {
    if (closed) throw new Error("Export artifact store is closed");
    const root = (await resolveRoot()).path;
    const canonicalSourcePath = await realpath(sourceZipPath);
    let sourceHandle: FileHandle | undefined;
    let stagedHandle: FileHandle | undefined;
    let stagedPath: string | undefined;
    let primaryError: { value: unknown } | null = null;
    let token: string | undefined;
    let stagedIdentity: ArtifactIdentity | undefined;

    try {
      sourceHandle = await open(canonicalSourcePath, readFlags());
      const sourceStat = asArtifactStat(await sourceHandle.stat({ bigint: true }));
      if (!sourceStat.isFile()) throw new Error("Export archive source is not a regular file");

      for (let attempt = 0; attempt < 8; attempt += 1) {
        const candidate = randomBytes(TOKEN_BYTES);
        if (candidate.byteLength !== TOKEN_BYTES) {
          throw new Error(`Export artifact randomness must contain exactly ${TOKEN_BYTES} bytes`);
        }
        token = candidate.toString("base64url");
        if (!TOKEN_PATTERN.test(token) || records.has(token)) continue;
        stagedPath = join(root, `${token}.zip`);
        try {
          stagedHandle = await open(stagedPath, writeFlags(), 0o600);
          const initialStage = asArtifactStat(await stagedHandle.stat({ bigint: true }));
          if (!initialStage.isFile() || initialStage.nlink !== 1n) {
            throw new Error("New export artifact stage is not an exclusive regular file");
          }
          stagedIdentity = identityOf(initialStage);
          break;
        } catch (error) {
          const code = typeof error === "object" && error !== null && "code" in error
            ? error.code
            : undefined;
          if (code !== "EEXIST") throw error;
        }
      }
      if (!token || !stagedPath || !stagedHandle) {
        throw new Error("Could not allocate a unique export artifact token");
      }

      await copyFileHandles(sourceHandle, stagedHandle);
      await stagedHandle.sync();
      const stagedStat = asArtifactStat(await stagedHandle.stat({ bigint: true }));
      if (!stagedStat.isFile() || stagedStat.nlink !== 1n || stagedStat.size !== sourceStat.size) {
        throw new Error("Staged export artifact failed regular-file verification");
      }
      stagedIdentity = identityOf(stagedStat);
    } catch (error) {
      primaryError = { value: error };
    }

    await closeHandles(
      [stagedHandle, sourceHandle].filter((handle): handle is FileHandle => handle !== undefined),
      primaryError,
    ).catch(async (error) => {
      if (stagedPath && stagedIdentity) {
        await deleteArtifactFile({ path: stagedPath, identity: stagedIdentity }).catch(() => undefined);
      }
      throw error;
    });

    if (closed) {
      const closeError = new Error("Export artifact store is closed");
      try {
        await deleteArtifactFile({ path: stagedPath!, identity: stagedIdentity! });
      } catch (cleanupError) {
        throw new AggregateError(
          [closeError, cleanupError],
          "Export artifact staging was cancelled and cleanup failed",
          { cause: cleanupError },
        );
      }
      throw closeError;
    }

    const expiresAt = now() + ttlMs;
    const record: ArtifactRecord = {
      path: stagedPath!,
      identity: stagedIdentity!,
      expiresAt,
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
    };
    records.set(token!, record);
    scheduleExpiry(token!, record);
    return {
      downloadUrl: `/api/export/artifacts/${token!}`,
      outputDir,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  };

  const stage = (sourceZipPath: string, outputDir: string): Promise<ExportArtifactTicket> => {
    if (closed) return Promise.reject(new Error("Export artifact store is closed"));
    const operation = stageArtifact(sourceZipPath, outputDir);
    inFlightStages.add(operation);
    void operation.then(
      () => { inFlightStages.delete(operation); },
      () => { inFlightStages.delete(operation); },
    );
    return operation;
  };

  const consume = async (token: string): Promise<ExportArtifactLookup> => {
    if (closed) return { status: "missing" };
    if (!TOKEN_PATTERN.test(token)) return { status: "missing" };
    if (expiredTokens.has(token)) return { status: "expired" };
    const record = records.get(token);
    if (!record) return { status: "missing" };

    // Delete synchronously before any pathname inspection/open so two consumers cannot win.
    records.delete(token);
    clearTimeout(record.timer);
    if (now() >= record.expiresAt) {
      expiredTokens.add(token);
      forgetExpiredTokenLater(token);
      await deleteArtifactFile(record).catch(() => undefined);
      return { status: "expired" };
    }

    let handle: FileHandle | undefined;
    const invalid = async (): Promise<ExportArtifactLookup> => {
      await deleteArtifactFile(record).catch(() => undefined);
      return { status: "invalid" };
    };
    try {
      const pathBeforeOpen = asArtifactStat(await lstat(record.path, { bigint: true }));
      if (!isExpectedArtifact(pathBeforeOpen, record.identity)) return invalid();
      handle = await open(record.path, readFlags());
      const opened = asArtifactStat(await handle.stat({ bigint: true }));
      const pathAfterOpen = asArtifactStat(await lstat(record.path, { bigint: true }));
      if (!isExpectedArtifact(opened, record.identity)
        || !isExpectedArtifact(pathAfterOpen, record.identity)
        || !sameIdentity(identityOf(opened), identityOf(pathAfterOpen))) {
        await handle.close();
        return invalid();
      }
    } catch {
      await handle?.close().catch(() => undefined);
      return invalid();
    }

    const stream = handle.createReadStream({ autoClose: true });
    let cleanupAttempt: Promise<void> | undefined;
    let cleanupComplete = false;
    let activeCleanupRetryTimer: ReturnType<typeof setTimeout> | undefined;
    const streamClosed = new Promise<void>((resolve) => { stream.once("close", resolve); });
    const scheduleActiveCleanupRetry = (): void => {
      if (closed || activeCleanupRetryTimer || cleanupComplete) return;
      activeCleanupRetryTimer = setTimeout(() => {
        activeCleanupRetryTimer = undefined;
        if (!closed) void artifact.dispose().catch(() => undefined);
      }, cleanupRetryDelayMs);
      unrefTimer(activeCleanupRetryTimer);
    };
    const finalize = async (): Promise<void> => {
      if (cleanupComplete) return;
      if (cleanupAttempt) return cleanupAttempt;
      const attempt = unlinkExpectedArtifact(record.path, record.identity, unlinkFile)
        .then(() => {
          cleanupComplete = true;
          if (activeExpiryTimer) clearTimeout(activeExpiryTimer);
          if (activeCleanupRetryTimer) clearTimeout(activeCleanupRetryTimer);
          activeArtifacts.delete(artifact);
        }, (error) => {
          scheduleActiveCleanupRetry();
          throw error;
        });
      cleanupAttempt = attempt;
      try {
        await attempt;
      } finally {
        if (cleanupAttempt === attempt) cleanupAttempt = undefined;
      }
    };
    const cleanup = streamClosed.then(finalize);
    // The route observes this promise too, but keep the store safe for direct consumers that do not.
    void cleanup.catch(() => undefined);
    const artifact: ExportArtifact = {
      stream,
      size: record.identity.size,
      filename: DOWNLOAD_FILENAME,
      cleanup,
      async dispose() {
        if (!stream.destroyed) stream.destroy();
        await streamClosed;
        await finalize();
      },
    };
    activeArtifacts.add(artifact);
    const activeExpiryTimer = setTimeout(() => {
      if (!closed) void artifact.dispose().catch(() => undefined);
    }, Math.max(1, record.expiresAt - now()));
    unrefTimer(activeExpiryTimer);
    return { status: "ready", artifact };
  };

  const close = async (): Promise<void> => {
    if (fullyClosed) return;
    closed = true;
    if (closeInFlight) return closeInFlight;
    const attempt = (async () => {
      await Promise.allSettled([...inFlightStages]);
      if (pendingCleanupTimer) {
        clearTimeout(pendingCleanupTimer);
        pendingCleanupTimer = undefined;
      }
      await pendingCleanupInFlight;
      for (const record of records.values()) clearTimeout(record.timer);
      for (const timer of tombstoneTimers.values()) clearTimeout(timer);
      const cleanupRecords = [...new Set([...records.values(), ...pendingFileCleanup])];
      records.clear();
      expiredTokens.clear();
      tombstoneTimers.clear();
      const cleanupResults = await Promise.allSettled([
        ...[...activeArtifacts].map((artifact) => artifact.dispose()),
        ...cleanupRecords.map((record) => deleteArtifactFile(record)),
      ]);
      const cleanupErrors = cleanupResults.flatMap((result) => (
        result.status === "rejected" ? [result.reason] : []
      ));
      if (cleanupErrors.length > 0) {
        throw new AggregateError(cleanupErrors, "Export artifact store cleanup failed");
      }
      const root = await rootPromise;
      if (root?.owned) await rm(root.path, { recursive: true, force: true });
      fullyClosed = true;
    })();
    closeInFlight = attempt;
    try {
      await attempt;
    } finally {
      if (closeInFlight === attempt) closeInFlight = undefined;
    }
  };

  return { stage, consume, close };
}

const defaultStoreKey = Symbol.for("screenshot-studio.export-artifact-store");
const processStores = globalThis as typeof globalThis & Record<symbol, unknown>;
const defaultStore = (processStores[defaultStoreKey] as ExportArtifactStore | undefined)
  ?? createExportArtifactStore();
processStores[defaultStoreKey] = defaultStore;

export function stageExportArtifact(
  sourceZipPath: string,
  outputDir: string,
): Promise<ExportArtifactTicket> {
  return defaultStore.stage(sourceZipPath, outputDir);
}

export function consumeExportArtifact(token: string): Promise<ExportArtifactLookup> {
  return defaultStore.consume(token);
}
