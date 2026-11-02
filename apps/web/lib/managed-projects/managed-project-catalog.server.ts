// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { lstat, open, readFile, rename, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import type { ManagedProjectStorageConfig } from "./managed-project-config.server.js";
import {
  entriesMatch,
  incrementSafeInteger,
  MAX_PENDING_DELETIONS,
  parseDeletion,
  parseEntry,
  parseManagedProjectCatalog,
  PROJECT_ID_PATTERN,
  projectOrdinalForNamespace,
  requireOperationId,
  requireTimestamp,
  serializeManagedProjectCatalog,
  trimCompletedDeletions,
  validateCatalog,
  type ActiveManagedProjectCatalogEntry,
  type ManagedProjectCatalogDocument,
  type ManagedProjectCatalogEntry,
  type ManagedProjectDeletionComplete,
  type ManagedProjectDeletionEvidence,
  type ManagedProjectDeletionPending,
  type ManagedProjectDeletionReservation,
} from "./managed-project-catalog-document.server.js";
import {
  assertManagedProjectLifecycleLockHeld,
  ensureManagedStorageRoot,
  validateManagedStorageChildRoot,
  type ManagedProjectLifecycleLock,
} from "./managed-project-lifecycle-lock.server.js";
import { acquireStorageLock } from "@web/lib/storage-lock.server.js";
import { errorCode } from "@screenshot-studio/core/storage";
import { writePrivateJsonDocument } from "@web/lib/private-json-document.server.js";

export interface ManagedProjectCatalogStoreDependencies {
  openFile?: (path: string, flags: number, mode: number) => Promise<FileHandle>;
  writeStageFile?: (handle: FileHandle, bytes: string) => Promise<void>;
  rename?: (oldPath: string, newPath: string) => Promise<void>;
  createIdNamespace?: () => string;
}

export class ManagedProjectCatalogStore {
  readonly #openFile: NonNullable<ManagedProjectCatalogStoreDependencies["openFile"]>;
  readonly #writeStageFile: NonNullable<ManagedProjectCatalogStoreDependencies["writeStageFile"]>;
  readonly #rename: NonNullable<ManagedProjectCatalogStoreDependencies["rename"]>;
  readonly #createIdNamespace: NonNullable<ManagedProjectCatalogStoreDependencies["createIdNamespace"]>;

  constructor(
    readonly config: ManagedProjectStorageConfig,
    dependencies: ManagedProjectCatalogStoreDependencies = {},
  ) {
    this.#openFile = dependencies.openFile ?? ((path, flags, mode) => open(path, flags, mode));
    this.#writeStageFile = dependencies.writeStageFile
      ?? (async (handle, bytes) => handle.writeFile(bytes, "utf8"));
    this.#rename = dependencies.rename ?? rename;
    this.#createIdNamespace = dependencies.createIdNamespace
      ?? (() => randomUUID().replaceAll("-", "").slice(0, 16));
  }

  async read(): Promise<ManagedProjectCatalogDocument> {
    return this.#withLock(() => this.#readOrInitialize());
  }

  async get(id: string): Promise<ManagedProjectCatalogEntry | undefined> {
    return this.getActive(id);
  }

  async getActive(id: string): Promise<ActiveManagedProjectCatalogEntry | undefined> {
    const catalog = await this.read();
    const reserved = catalog.deletions.some((evidence) =>
      evidence.projectId === id && evidence.state === "reserved");
    return reserved ? undefined : catalog.entries.find((entry) => entry.id === id);
  }

  async list(): Promise<ActiveManagedProjectCatalogEntry[]> { return this.listActive(); }

  async listActive(): Promise<ActiveManagedProjectCatalogEntry[]> {
    const catalog = await this.read();
    const reservedIds = new Set(catalog.deletions
      .filter((evidence) => evidence.state === "reserved")
      .map((evidence) => evidence.projectId));
    return catalog.entries.filter((entry) => !reservedIds.has(entry.id));
  }

  async reserveProjectId(): Promise<string> {
    return this.#withLock(async () => {
      const catalog = await this.#readOrInitialize();
      const ordinal = catalog.nextProjectOrdinal;
      const id = `project_${catalog.idNamespace}${ordinal.toString(16).padStart(16, "0")}`;
      if (!PROJECT_ID_PATTERN.test(id)) throw new Error("Managed project id allocator is exhausted");
      await this.#write({
        ...catalog,
        generation: incrementSafeInteger(catalog.generation, "Managed project catalog generation"),
        nextProjectOrdinal: incrementSafeInteger(ordinal, "Managed project id ordinal"),
      });
      return id;
    });
  }

  async insert(entry: ActiveManagedProjectCatalogEntry): Promise<void> {
    await this.#withLock(async () => {
      const catalog = await this.#readOrInitialize();
      if (catalog.entries.some((existing) => existing.id === entry.id)) {
        throw new Error(`Managed project catalog contains a duplicate id: ${entry.id}`);
      }
      if (catalog.deletions.some((evidence) => evidence.projectId === entry.id)) {
        throw new Error(`Managed project catalog contains deletion evidence for id: ${entry.id}`);
      }
      parseEntry(entry);
      const ordinal = projectOrdinalForNamespace(entry.id, catalog.idNamespace);
      const nextProjectOrdinal = ordinal !== undefined && ordinal >= catalog.nextProjectOrdinal
        ? incrementSafeInteger(ordinal, "Managed project id ordinal")
        : catalog.nextProjectOrdinal;
      await this.#write({
        ...catalog,
        generation: incrementSafeInteger(catalog.generation, "Managed project catalog generation"),
        nextProjectOrdinal,
        entries: [...catalog.entries, entry],
      });
    });
  }

  async removeActive(id: string, expectedLifecycleRevision: number): Promise<void> {
    await this.#withLock(async () => {
      const catalog = await this.#readOrInitialize();
      const entry = catalog.entries.find((candidate) => candidate.id === id);
      if (!entry || entry.lifecycle !== "active") throw new Error("Managed project is not active");
      if (catalog.deletions.some((evidence) => evidence.projectId === id)) {
        throw new Error("Managed project has an active deletion reservation");
      }
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

  async getDeletionEvidence(operationId: string): Promise<ManagedProjectDeletionEvidence | undefined> {
    requireOperationId(operationId);
    return (await this.read()).deletions.find((evidence) => evidence.operationId === operationId);
  }

  async reserveDeletion(
    input: ManagedProjectDeletionReservation,
  ): Promise<ManagedProjectDeletionReservation> {
    return this.#withLock(async () => {
      const reservation = parseDeletion(input);
      if (reservation.state !== "reserved") throw new TypeError("Deletion admission must be a reservation");
      const catalog = await this.#readOrInitialize();
      const existingOperation = catalog.deletions.find(
        (evidence) => evidence.operationId === reservation.operationId,
      );
      if (existingOperation) {
        if (existingOperation.state === "reserved"
          && JSON.stringify(existingOperation) === JSON.stringify(reservation)) return existingOperation;
        throw new Error("Deletion operation id already exists");
      }
      if (catalog.deletions.some((evidence) => evidence.projectId === reservation.projectId)) {
        throw new Error("Managed project already has deletion evidence");
      }
      if (catalog.deletions.filter((evidence) => evidence.state !== "complete").length
        >= MAX_PENDING_DELETIONS) {
        throw new Error("Managed project catalog pending deletion limit reached");
      }
      const active = catalog.entries.find((entry) => entry.id === reservation.projectId);
      if (!active) throw new Error("Managed project is not active");
      if (active.lifecycleRevision !== reservation.lifecycleRevision) {
        throw new Error("Managed project lifecycle revision changed");
      }
      if (!entriesMatch(active, reservation.priorEntry)) {
        throw new Error("Deletion reservation does not match the active catalog entry");
      }
      await this.#write({
        ...catalog,
        generation: incrementSafeInteger(catalog.generation, "Managed project catalog generation"),
        deletions: [...catalog.deletions, reservation],
      });
      return reservation;
    });
  }

  async commitDeletion(operationId: string): Promise<ManagedProjectDeletionEvidence> {
    requireOperationId(operationId);
    return this.#withLock(async () => {
      const catalog = await this.#readOrInitialize();
      const evidence = catalog.deletions.find((candidate) => candidate.operationId === operationId);
      if (!evidence) throw new Error("Deletion operation does not exist");
      if (evidence.state !== "reserved") return evidence;
      const active = catalog.entries.find((entry) => entry.id === evidence.projectId);
      if (!active || !entriesMatch(active, evidence.priorEntry)) {
        throw new Error("Deletion reservation no longer matches the active catalog entry");
      }
      const pending: ManagedProjectDeletionPending = {
        operationId: evidence.operationId,
        operation: "delete",
        state: "cleanup-pending",
        projectId: evidence.projectId,
        lifecycleRevision: evidence.lifecycleRevision,
        statusSecretHash: evidence.statusSecretHash,
        projectRevision: evidence.projectRevision,
        sourceIdentity: evidence.sourceIdentity,
      };
      await this.#write({
        ...catalog,
        generation: incrementSafeInteger(catalog.generation, "Managed project catalog generation"),
        entries: catalog.entries.filter((entry) => entry.id !== evidence.projectId),
        deletions: catalog.deletions.map((candidate) =>
          candidate.operationId === operationId ? pending : candidate),
      });
      return pending;
    });
  }

  async completeDeletionAfterIntentRemoval(
    operationId: string,
    completedAt: string,
    lifecycleLock: ManagedProjectLifecycleLock,
  ): Promise<ManagedProjectDeletionComplete> {
    requireOperationId(operationId);
    const timestamp = requireTimestamp(completedAt, "completedAt");
    return this.#withLock(async () => {
      const catalog = await this.#readOrInitialize();
      const evidence = catalog.deletions.find((candidate) => candidate.operationId === operationId);
      if (!evidence) throw new Error("Deletion operation does not exist");
      assertManagedProjectLifecycleLockHeld(lifecycleLock, this.config, evidence.projectId);
      if (evidence.state !== "cleanup-pending" && evidence.state !== "complete") {
        throw new Error("Deletion cleanup cannot complete before catalog admission commits");
      }
      await validateManagedStorageChildRoot(this.config, this.config.recoveryRoot);
      try {
        await lstat(join(this.config.recoveryRoot, `${evidence.projectId}.json`));
        throw new Error("Deletion recovery intent must be removed before completion");
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
      }
      if (evidence.state === "complete") return evidence;
      const complete: ManagedProjectDeletionComplete = {
        operationId: evidence.operationId,
        operation: "delete",
        state: "complete",
        projectId: evidence.projectId,
        lifecycleRevision: evidence.lifecycleRevision,
        statusSecretHash: evidence.statusSecretHash,
        projectRevision: evidence.projectRevision,
        completedAt: timestamp,
      };
      await this.#write({
        ...catalog,
        generation: incrementSafeInteger(catalog.generation, "Managed project catalog generation"),
        deletions: trimCompletedDeletions(catalog.deletions.map((candidate) =>
          candidate.operationId === operationId ? complete : candidate)),
      });
      return complete;
    });
  }

  async #readPersisted(): Promise<ManagedProjectCatalogDocument> {
    const value = JSON.parse(await readFile(this.config.catalogPath, "utf8")) as unknown;
    return parseManagedProjectCatalog(value);
  }

  async #readOrInitialize(): Promise<ManagedProjectCatalogDocument> {
    try {
      return await this.#readPersisted();
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      const empty: ManagedProjectCatalogDocument = {
        version: 1,
        generation: 0,
        idNamespace: this.#createIdNamespace(),
        nextProjectOrdinal: 1,
        entries: [],
        deletions: [],
      };
      try {
        await this.#write(empty);
        return empty;
      } catch (writeError) {
        if (errorCode(writeError) !== "EEXIST") throw writeError;
        return await this.#readPersisted();
      }
    }
  }

  async #withLock<T>(operation: () => Promise<T>): Promise<T> {
    await ensureManagedStorageRoot(this.config);
    const release = await acquireStorageLock(join(this.config.root, ".catalog.lock"), {
      stale: 30_000,
      update: 10_000,
      timeoutMs: 30_000,
      retryDelayMs: 50,
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
    await writePrivateJsonDocument({
      root: this.config.root,
      targetPath: this.config.catalogPath,
      stagePrefix: ".catalog",
      label: "Catalog",
      contents: serializeManagedProjectCatalog(catalog),
      openFile: this.#openFile,
      rename: this.#rename,
      writeStage: this.#writeStageFile,
    });
  }
}
