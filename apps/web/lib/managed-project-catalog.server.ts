// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, rename, rm, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { lock as acquireFileLock } from "proper-lockfile";
import type { ManagedProjectStorageConfig } from "./managed-project-config.server.js";

const PROJECT_ID_PATTERN = /^project_[0-9a-f]{32}$/;
const OPERATION_ID_PATTERN = /^operation_[0-9a-f]{32}$/;
const MAX_TRASH_LIST_RESULTS = 100;

interface ManagedProjectCatalogEntryBase {
  id: string;
  directoryName: string;
  name: string;
  lifecycleRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ActiveManagedProjectCatalogEntry extends ManagedProjectCatalogEntryBase {
  lifecycle: "active";
}

export interface TrashedManagedProjectCatalogEntry extends ManagedProjectCatalogEntryBase {
  lifecycle: "trashed";
  trashedAt: string;
}

export type ManagedProjectCatalogEntry =
  | ActiveManagedProjectCatalogEntry
  | TrashedManagedProjectCatalogEntry;

export interface ManagedProjectLifecycleCommit {
  operationId: string;
  operation: "purge";
  projectId: string;
  lifecycleRevision: number;
}

export interface ManagedProjectCatalogDocument {
  version: 2;
  generation: number;
  entries: ManagedProjectCatalogEntry[];
  lifecycleCommits: ManagedProjectLifecycleCommit[];
}

export interface ManagedProjectCatalogStoreDependencies {
  openFile?: (path: string, flags: number, mode: number) => Promise<FileHandle>;
  writeStageFile?: (handle: FileHandle, bytes: string) => Promise<void>;
  rename?: (oldPath: string, newPath: string) => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireExactKeys(value: Record<string, unknown>, keys: readonly string[], context: string): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw new TypeError(`${context} contains unknown or missing properties`);
  }
}

function requireTimestamp(value: unknown, property: string): string {
  if (typeof value !== "string") throw new TypeError(`${property} must be an ISO timestamp`);
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== value) {
    throw new TypeError(`${property} must be an ISO timestamp`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, property: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${property} must be a positive integer`);
  }
  return value as number;
}

function incrementSafeInteger(value: number, property: string): number {
  if (!Number.isSafeInteger(value) || value >= Number.MAX_SAFE_INTEGER) {
    throw new Error(`${property} cannot be incremented safely`);
  }
  return value + 1;
}

function parseEntry(value: unknown, legacy = false): ManagedProjectCatalogEntry {
  if (!isRecord(value)) throw new TypeError("catalog entry must be an object");
  const lifecycle = value.lifecycle;
  const keys = legacy
    ? ["id", "directoryName", "name", "lifecycle", "createdAt", "updatedAt"]
    : lifecycle === "trashed"
      ? ["id", "directoryName", "name", "lifecycle", "lifecycleRevision", "createdAt", "updatedAt", "trashedAt"]
      : ["id", "directoryName", "name", "lifecycle", "lifecycleRevision", "createdAt", "updatedAt"];
  requireExactKeys(value, keys, "catalog entry");
  if (typeof value.id !== "string" || !PROJECT_ID_PATTERN.test(value.id)) {
    throw new TypeError("catalog entry id must be an opaque managed project id");
  }
  if (value.directoryName !== value.id) {
    throw new TypeError("catalog entry directoryName must equal its id");
  }
  if (typeof value.name !== "string" || value.name.length === 0) {
    throw new TypeError("catalog entry name must be a non-empty string");
  }
  if (legacy && lifecycle !== "active") throw new TypeError("legacy catalog entry lifecycle must be active");
  if (lifecycle !== "active" && lifecycle !== "trashed") {
    throw new TypeError("catalog entry lifecycle must be active or trashed");
  }
  const base: ManagedProjectCatalogEntryBase = {
    id: value.id,
    directoryName: value.id,
    name: value.name,
    lifecycleRevision: legacy ? 1 : requirePositiveInteger(value.lifecycleRevision, "catalog entry lifecycleRevision"),
    createdAt: requireTimestamp(value.createdAt, "catalog entry createdAt"),
    updatedAt: requireTimestamp(value.updatedAt, "catalog entry updatedAt"),
  };
  return lifecycle === "trashed"
    ? { ...base, lifecycle, trashedAt: requireTimestamp(value.trashedAt, "catalog entry trashedAt") }
    : { ...base, lifecycle };
}

function parseCommit(value: unknown): ManagedProjectLifecycleCommit {
  if (!isRecord(value)) throw new TypeError("lifecycle commit must be an object");
  requireExactKeys(value, ["operationId", "operation", "projectId", "lifecycleRevision"], "lifecycle commit");
  if (typeof value.operationId !== "string" || !OPERATION_ID_PATTERN.test(value.operationId)) {
    throw new TypeError("lifecycle commit operationId must be opaque");
  }
  if (value.operation !== "purge") throw new TypeError("lifecycle commit operation must be purge");
  if (typeof value.projectId !== "string" || !PROJECT_ID_PATTERN.test(value.projectId)) {
    throw new TypeError("lifecycle commit projectId must be opaque");
  }
  return {
    operationId: value.operationId,
    operation: "purge",
    projectId: value.projectId,
    lifecycleRevision: requirePositiveInteger(value.lifecycleRevision, "lifecycle commit lifecycleRevision"),
  };
}

export function parseManagedProjectCatalog(value: unknown): ManagedProjectCatalogDocument {
  if (!isRecord(value)) throw new TypeError("managed project catalog must be an object");
  if (value.version === 1) {
    requireExactKeys(value, ["version", "entries"], "managed project catalog");
    if (!Array.isArray(value.entries)) throw new TypeError("managed project catalog entries must be an array");
    return validateCatalog({
      version: 2,
      generation: 0,
      entries: value.entries.map((entry) => parseEntry(entry, true)),
      lifecycleCommits: [],
    });
  }
  requireExactKeys(value, ["version", "generation", "entries", "lifecycleCommits"], "managed project catalog");
  if (value.version !== 2) throw new TypeError("managed project catalog version must be 1 or 2");
  if (!Number.isSafeInteger(value.generation) || (value.generation as number) < 0) {
    throw new TypeError("managed project catalog generation must be a non-negative integer");
  }
  if (!Array.isArray(value.entries)) throw new TypeError("managed project catalog entries must be an array");
  if (!Array.isArray(value.lifecycleCommits)) throw new TypeError("managed project catalog lifecycleCommits must be an array");
  return validateCatalog({
    version: 2,
    generation: value.generation as number,
    entries: value.entries.map((entry) => parseEntry(entry)),
    lifecycleCommits: value.lifecycleCommits.map(parseCommit),
  });
}

function validateCatalog(catalog: ManagedProjectCatalogDocument): ManagedProjectCatalogDocument {
  const ids = new Set(catalog.entries.map((entry) => entry.id));
  if (ids.size !== catalog.entries.length) throw new TypeError("managed project catalog entries must not duplicate ids");
  const operationIds = new Set(catalog.lifecycleCommits.map((commit) => commit.operationId));
  if (operationIds.size !== catalog.lifecycleCommits.length) {
    throw new TypeError("managed project catalog lifecycle commits must not duplicate operation ids");
  }
  const purgedProjectIds = new Set(catalog.lifecycleCommits.map((commit) => commit.projectId));
  if (purgedProjectIds.size !== catalog.lifecycleCommits.length) {
    throw new TypeError("managed project catalog must not contain multiple purge receipts for one project");
  }
  if (catalog.entries.some((entry) => purgedProjectIds.has(entry.id))) {
    throw new TypeError("managed project catalog purge receipts must not reference live entries");
  }
  return catalog;
}

export function serializeManagedProjectCatalog(catalog: ManagedProjectCatalogDocument): string {
  const entries = [...catalog.entries]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((entry) => ({
      id: entry.id,
      directoryName: entry.directoryName,
      name: entry.name,
      lifecycle: entry.lifecycle,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      lifecycleRevision: entry.lifecycleRevision,
      ...(entry.lifecycle === "trashed" ? { trashedAt: entry.trashedAt } : {}),
    }));
  const lifecycleCommits = [...catalog.lifecycleCommits]
    .sort((left, right) => left.operationId.localeCompare(right.operationId));
  return `${JSON.stringify({ version: 2, generation: catalog.generation, entries, lifecycleCommits }, null, 2)}\n`;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    && typeof error.code === "string" ? error.code : undefined;
}

function noFollowFlags(flags: number): number {
  return flags | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0);
}

async function syncDirectoryBestEffort(directory: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(directory, constants.O_RDONLY);
    await handle.sync();
  } catch {
    // Some supported local filesystems do not permit directory fsync.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export class ManagedProjectCatalogStore {
  readonly #openFile: NonNullable<ManagedProjectCatalogStoreDependencies["openFile"]>;
  readonly #writeStageFile: NonNullable<ManagedProjectCatalogStoreDependencies["writeStageFile"]>;
  readonly #rename: NonNullable<ManagedProjectCatalogStoreDependencies["rename"]>;

  constructor(
    readonly config: ManagedProjectStorageConfig,
    dependencies: ManagedProjectCatalogStoreDependencies = {},
  ) {
    this.#openFile = dependencies.openFile ?? ((path, flags, mode) => open(path, flags, mode));
    this.#writeStageFile = dependencies.writeStageFile
      ?? (async (handle, bytes) => handle.writeFile(bytes, "utf8"));
    this.#rename = dependencies.rename ?? rename;
  }

  async read(): Promise<ManagedProjectCatalogDocument> {
    return this.#withLock(() => this.#readOrInitialize());
  }

  async get(id: string): Promise<ManagedProjectCatalogEntry | undefined> {
    return (await this.read()).entries.find((entry) => entry.id === id);
  }

  async getActive(id: string): Promise<ActiveManagedProjectCatalogEntry | undefined> {
    const entry = await this.get(id);
    return entry?.lifecycle === "active" ? entry : undefined;
  }

  async list(): Promise<ActiveManagedProjectCatalogEntry[]> { return this.listActive(); }

  async listActive(): Promise<ActiveManagedProjectCatalogEntry[]> {
    return (await this.read()).entries.filter(
      (entry): entry is ActiveManagedProjectCatalogEntry => entry.lifecycle === "active",
    );
  }

  async listTrashed(limit: number): Promise<TrashedManagedProjectCatalogEntry[]> {
    requirePositiveInteger(limit, "Trash list limit");
    if (limit > MAX_TRASH_LIST_RESULTS) {
      throw new TypeError(`Trash list limit must be at most ${MAX_TRASH_LIST_RESULTS}`);
    }
    return (await this.read()).entries
      .filter((entry): entry is TrashedManagedProjectCatalogEntry => entry.lifecycle === "trashed")
      .sort((left, right) => right.trashedAt.localeCompare(left.trashedAt) || left.id.localeCompare(right.id))
      .slice(0, limit);
  }

  async insert(entry: ActiveManagedProjectCatalogEntry): Promise<void> {
    await this.#withLock(async () => {
      const catalog = await this.#readOrInitialize();
      if (catalog.entries.some((existing) => existing.id === entry.id)) {
        throw new Error(`Managed project catalog contains a duplicate id: ${entry.id}`);
      }
      parseEntry(entry);
      await this.#write({
        ...catalog,
        generation: incrementSafeInteger(catalog.generation, "Managed project catalog generation"),
        entries: [...catalog.entries, entry],
      });
    });
  }

  async transitionToTrashed(
    id: string,
    expectedLifecycleRevision: number,
    trashedAt: string,
  ): Promise<TrashedManagedProjectCatalogEntry> {
    return this.#withLock(async () => {
      const catalog = await this.#readOrInitialize();
      const entry = catalog.entries.find((candidate) => candidate.id === id);
      if (!entry || entry.lifecycle !== "active") throw new Error("Managed project is not active");
      if (entry.lifecycleRevision !== expectedLifecycleRevision) {
        throw new Error("Managed project lifecycle revision changed");
      }
      const timestamp = requireTimestamp(trashedAt, "trashedAt");
      const next: TrashedManagedProjectCatalogEntry = {
        ...entry,
        lifecycle: "trashed",
        lifecycleRevision: incrementSafeInteger(entry.lifecycleRevision, "Managed project lifecycle revision"),
        updatedAt: timestamp,
        trashedAt: timestamp,
      };
      await this.#write({
        ...catalog,
        generation: incrementSafeInteger(catalog.generation, "Managed project catalog generation"),
        entries: catalog.entries.map((candidate) => candidate.id === id ? next : candidate),
      });
      return next;
    });
  }

  async removeTrashedWithReceipt(
    id: string,
    expectedLifecycleRevision: number,
    receipt: ManagedProjectLifecycleCommit,
  ): Promise<void> {
    await this.#withLock(async () => {
      const catalog = await this.#readOrInitialize();
      const entry = catalog.entries.find((candidate) => candidate.id === id);
      if (!entry || entry.lifecycle !== "trashed") throw new Error("Managed project is not trashed");
      if (entry.lifecycleRevision !== expectedLifecycleRevision) {
        throw new Error("Managed project lifecycle revision changed");
      }
      const parsedReceipt = parseCommit(receipt);
      if (parsedReceipt.projectId !== id || parsedReceipt.lifecycleRevision !== expectedLifecycleRevision) {
        throw new Error("Purge receipt does not match the trashed project");
      }
      if (catalog.lifecycleCommits.some((commit) => commit.operationId === parsedReceipt.operationId)) {
        throw new Error("Managed project catalog contains a duplicate lifecycle operation id");
      }
      await this.#write({
        ...catalog,
        generation: incrementSafeInteger(catalog.generation, "Managed project catalog generation"),
        entries: catalog.entries.filter((candidate) => candidate.id !== id),
        lifecycleCommits: [...catalog.lifecycleCommits, parsedReceipt],
      });
    });
  }

  async removeActive(id: string, expectedLifecycleRevision: number): Promise<void> {
    await this.#withLock(async () => {
      const catalog = await this.#readOrInitialize();
      const entry = catalog.entries.find((candidate) => candidate.id === id);
      if (!entry || entry.lifecycle !== "active") throw new Error("Managed project is not active");
      if (entry.lifecycleRevision !== expectedLifecycleRevision) {
        throw new Error("Managed project lifecycle revision changed");
      }
      await this.#write({
        ...catalog,
        generation: incrementSafeInteger(catalog.generation, "Managed project catalog generation"),
        entries: catalog.entries.filter((candidate) => candidate.id !== id),
      });
    });
  }

  async #readPersisted(): Promise<{ catalog: ManagedProjectCatalogDocument; migrated: boolean }> {
    const value = JSON.parse(await readFile(this.config.catalogPath, "utf8")) as unknown;
    return { catalog: parseManagedProjectCatalog(value), migrated: isRecord(value) && value.version === 1 };
  }

  async #readOrInitialize(): Promise<ManagedProjectCatalogDocument> {
    try {
      const { catalog, migrated } = await this.#readPersisted();
      if (migrated) await this.#write(catalog);
      return catalog;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      const empty: ManagedProjectCatalogDocument = {
        version: 2,
        generation: 0,
        entries: [],
        lifecycleCommits: [],
      };
      try {
        await this.#write(empty);
        return empty;
      } catch (writeError) {
        if (errorCode(writeError) !== "EEXIST") throw writeError;
        return (await this.#readPersisted()).catalog;
      }
    }
  }

  async #withLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.config.root, { recursive: true, mode: 0o700 });
    const release = await acquireFileLock(this.config.root, {
      lockfilePath: join(this.config.root, ".catalog.lock"),
      realpath: true,
      stale: 30_000,
      update: 10_000,
      retries: { retries: 600, factor: 1, minTimeout: 50, maxTimeout: 50, randomize: false },
    });
    let result: T | undefined;
    let operationError: unknown;
    let releaseError: unknown;
    let completed = false;
    try {
      result = await operation();
      completed = true;
    } catch (error) {
      operationError = error;
    } finally {
      try { await release(); } catch (error) { releaseError = error; }
    }
    if (releaseError) {
      if (!completed) {
        throw new AggregateError(
          [operationError, releaseError],
          "Managed project catalog mutation and lock release both failed",
          { cause: releaseError },
        );
      }
      throw releaseError;
    }
    if (!completed) throw operationError;
    return result as T;
  }

  async #write(catalog: ManagedProjectCatalogDocument): Promise<void> {
    validateCatalog(catalog);
    const stagePath = join(this.config.root, `.catalog.${randomUUID()}.stage`);
    let handle: FileHandle | undefined;
    let ownsStage = false;
    try {
      handle = await this.#openFile(
        stagePath,
        noFollowFlags(constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY),
        0o600,
      );
      ownsStage = true;
      await this.#writeStageFile(handle, serializeManagedProjectCatalog(catalog));
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.#rename(stagePath, this.config.catalogPath);
      ownsStage = false;
      await syncDirectoryBestEffort(this.config.root);
    } catch (error) {
      let primaryError = error;
      if (handle) {
        try { await handle.close(); } catch (closeError) {
          primaryError = new AggregateError([primaryError, closeError], "Catalog stage close failed", { cause: closeError });
        }
      }
      if (ownsStage) {
        try { await rm(stagePath, { force: true }); } catch (cleanupError) {
          throw new AggregateError([primaryError, cleanupError], "Catalog stage cleanup failed", { cause: cleanupError });
        }
      }
      throw primaryError;
    }
  }
}
