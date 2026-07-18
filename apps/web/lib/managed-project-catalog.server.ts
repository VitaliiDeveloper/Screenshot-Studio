// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, rename, rm, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { lock as acquireFileLock } from "proper-lockfile";
import type { ManagedProjectStorageConfig } from "./managed-project-config.server.js";

const PROJECT_ID_PATTERN = /^project_[0-9a-f]{32}$/;

export interface ManagedProjectCatalogEntry {
  id: string;
  directoryName: string;
  name: string;
  lifecycle: "active";
  createdAt: string;
  updatedAt: string;
}

export interface ManagedProjectCatalogDocument {
  version: 1;
  entries: ManagedProjectCatalogEntry[];
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

function parseEntry(value: unknown): ManagedProjectCatalogEntry {
  if (!isRecord(value)) throw new TypeError("catalog entry must be an object");
  requireExactKeys(
    value,
    ["id", "directoryName", "name", "lifecycle", "createdAt", "updatedAt"],
    "catalog entry",
  );
  if (typeof value.id !== "string" || !PROJECT_ID_PATTERN.test(value.id)) {
    throw new TypeError("catalog entry id must be an opaque managed project id");
  }
  if (typeof value.directoryName !== "string" || value.directoryName !== value.id) {
    throw new TypeError("catalog entry directoryName must equal its id");
  }
  if (typeof value.name !== "string" || value.name.length === 0) {
    throw new TypeError("catalog entry name must be a non-empty string");
  }
  if (value.lifecycle !== "active") {
    throw new TypeError("catalog entry lifecycle must be active");
  }
  return {
    id: value.id,
    directoryName: value.directoryName,
    name: value.name,
    lifecycle: value.lifecycle,
    createdAt: requireTimestamp(value.createdAt, "catalog entry createdAt"),
    updatedAt: requireTimestamp(value.updatedAt, "catalog entry updatedAt"),
  };
}

export function parseManagedProjectCatalog(value: unknown): ManagedProjectCatalogDocument {
  if (!isRecord(value)) throw new TypeError("managed project catalog must be an object");
  requireExactKeys(value, ["version", "entries"], "managed project catalog");
  if (value.version !== 1) throw new TypeError("managed project catalog version must be 1");
  if (!Array.isArray(value.entries)) throw new TypeError("managed project catalog entries must be an array");
  const entries = value.entries.map(parseEntry);
  const ids = new Set(entries.map((entry) => entry.id));
  if (ids.size !== entries.length) throw new TypeError("managed project catalog entries must not duplicate ids");
  return { version: 1, entries };
}

export function serializeManagedProjectCatalog(catalog: ManagedProjectCatalogDocument): string {
  const entries = [...catalog.entries].sort((left, right) => left.id.localeCompare(right.id));
  return `${JSON.stringify({ version: 1, entries }, null, 2)}\n`;
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
    await mkdir(this.config.root, { recursive: true, mode: 0o700 });
    try {
      return await this.#readPersisted();
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      return this.#withLock(() => this.#readOrInitialize());
    }
  }

  async get(id: string): Promise<ManagedProjectCatalogEntry | undefined> {
    return (await this.read()).entries.find((entry) => entry.id === id);
  }

  async list(): Promise<ManagedProjectCatalogEntry[]> {
    return (await this.read()).entries;
  }

  async insert(entry: ManagedProjectCatalogEntry): Promise<void> {
    await this.#withLock(async () => {
      const catalog = await this.#readOrInitialize();
      if (catalog.entries.some((existing) => existing.id === entry.id)) {
        throw new Error(`Managed project catalog contains a duplicate id: ${entry.id}`);
      }
      await this.#write({ version: 1, entries: [...catalog.entries, entry] });
    });
  }

  async remove(id: string): Promise<void> {
    await this.#withLock(async () => {
      const catalog = await this.#readOrInitialize();
      const entries = catalog.entries.filter((entry) => entry.id !== id);
      if (entries.length === catalog.entries.length) return;
      await this.#write({ version: 1, entries });
    });
  }

  async #readPersisted(): Promise<ManagedProjectCatalogDocument> {
    return parseManagedProjectCatalog(JSON.parse(await readFile(this.config.catalogPath, "utf8")));
  }

  async #readOrInitialize(): Promise<ManagedProjectCatalogDocument> {
    try {
      return await this.#readPersisted();
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      const empty: ManagedProjectCatalogDocument = { version: 1, entries: [] };
      try {
        await this.#write(empty);
        return empty;
      } catch (writeError) {
        if (errorCode(writeError) !== "EEXIST") throw writeError;
        return this.#readPersisted();
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
      try {
        await release();
      } catch (error) {
        releaseError = error;
      }
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
        try {
          await handle.close();
        } catch (closeError) {
          primaryError = new AggregateError([primaryError, closeError], "Catalog stage close failed", {
            cause: closeError,
          });
        }
      }
      if (ownsStage) {
        try {
          await rm(stagePath, { force: true });
        } catch (cleanupError) {
          throw new AggregateError([primaryError, cleanupError], "Catalog stage cleanup failed", {
            cause: cleanupError,
          });
        }
      }
      throw primaryError;
    }
  }
}
