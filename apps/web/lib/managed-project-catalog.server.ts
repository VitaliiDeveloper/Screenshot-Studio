// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, rename, rm, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { lock as acquireFileLock } from "proper-lockfile";
import type { ManagedProjectStorageConfig } from "./managed-project-config.server.js";
import {
  assertManagedProjectLifecycleLockHeld,
  ensureManagedStorageRoot,
  validateManagedStorageChildRoot,
  type ManagedProjectLifecycleLock,
} from "./managed-project-lifecycle-lock.server.js";

const PROJECT_ID_PATTERN = /^project_[0-9a-f]{32}$/;
const OPERATION_ID_PATTERN = /^operation_[0-9a-f]{32}$/;
const ID_NAMESPACE_PATTERN = /^[0-9a-f]{16}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const MAX_PENDING_DELETIONS = 1_000;
const MAX_COMPLETED_DELETIONS = 256;

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

export type ManagedProjectCatalogEntry = ActiveManagedProjectCatalogEntry;

export interface ManagedDirectoryIdentity {
  device: string;
  inode: string;
}

interface ManagedProjectDeletionEvidenceBase {
  operationId: string;
  operation: "delete";
  projectId: string;
  lifecycleRevision: number;
  statusSecretHash: string;
}

export interface ManagedProjectDeletionReservation extends ManagedProjectDeletionEvidenceBase {
  state: "reserved";
  projectRevision: string;
  priorEntry: ActiveManagedProjectCatalogEntry;
  sourceIdentity: ManagedDirectoryIdentity;
}

export interface ManagedProjectDeletionPending extends ManagedProjectDeletionEvidenceBase {
  state: "cleanup-pending";
  projectRevision: string;
  sourceIdentity: ManagedDirectoryIdentity;
}

export interface ManagedProjectDeletionComplete extends ManagedProjectDeletionEvidenceBase {
  state: "complete";
  projectRevision: string;
  completedAt: string;
}

export type ManagedProjectDeletionEvidence =
  | ManagedProjectDeletionReservation
  | ManagedProjectDeletionPending
  | ManagedProjectDeletionComplete;

export interface ManagedProjectCatalogDocument {
  version: 2;
  generation: number;
  idNamespace: string;
  nextProjectOrdinal: number;
  entries: ManagedProjectCatalogEntry[];
  deletions: ManagedProjectDeletionEvidence[];
}

export interface ManagedProjectCatalogStoreDependencies {
  openFile?: (path: string, flags: number, mode: number) => Promise<FileHandle>;
  writeStageFile?: (handle: FileHandle, bytes: string) => Promise<void>;
  rename?: (oldPath: string, newPath: string) => Promise<void>;
  createIdNamespace?: () => string;
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

function projectOrdinalForNamespace(id: string, namespace: string): number | undefined {
  const prefix = `project_${namespace}`;
  if (!id.startsWith(prefix)) return undefined;
  const ordinal = BigInt(`0x${id.slice(prefix.length)}`);
  if (ordinal > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Managed project id namespace cannot advance safely past an existing id");
  }
  return Number(ordinal);
}

function createMigrationNamespace(
  ids: readonly string[],
  createIdNamespace: () => string,
): string {
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const namespace = createIdNamespace();
    if (!ID_NAMESPACE_PATTERN.test(namespace)) {
      throw new TypeError("catalog id namespace must be lowercase hex");
    }
    if (!ids.some((id) => id.startsWith(`project_${namespace}`))) return namespace;
  }
  throw new Error("Unable to allocate a non-conflicting managed project id namespace");
}

function isAbandonedLifecycleCatalog(value: unknown): boolean {
  return isRecord(value) && value.version === 2 && "lifecycleCommits" in value;
}

function parseEntry(value: unknown, legacy = false): ActiveManagedProjectCatalogEntry {
  if (!isRecord(value)) throw new TypeError("catalog entry must be an object");
  const lifecycle = value.lifecycle;
  const keys = legacy
    ? ["id", "directoryName", "name", "lifecycle", "createdAt", "updatedAt"]
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
  if (lifecycle !== "active") throw new TypeError("catalog entry lifecycle must be active");
  const base: ManagedProjectCatalogEntryBase = {
    id: value.id,
    directoryName: value.id,
    name: value.name,
    lifecycleRevision: legacy ? 1 : requirePositiveInteger(value.lifecycleRevision, "catalog entry lifecycleRevision"),
    createdAt: requireTimestamp(value.createdAt, "catalog entry createdAt"),
    updatedAt: requireTimestamp(value.updatedAt, "catalog entry updatedAt"),
  };
  return { ...base, lifecycle: "active" };
}

export function parseActiveManagedProjectCatalogEntry(
  value: unknown,
): ActiveManagedProjectCatalogEntry {
  return parseEntry(value);
}

function parseIdentity(value: unknown): ManagedDirectoryIdentity {
  if (!isRecord(value)) throw new TypeError("directory identity must be an object");
  requireExactKeys(value, ["device", "inode"], "directory identity");
  if (typeof value.device !== "string" || !/^\d+$/.test(value.device)
    || typeof value.inode !== "string" || !/^\d+$/.test(value.inode)) {
    throw new TypeError("directory identity must contain decimal device and inode strings");
  }
  return { device: value.device, inode: value.inode };
}

function parseDeletion(value: unknown): ManagedProjectDeletionEvidence {
  if (!isRecord(value)) throw new TypeError("deletion evidence must be an object");
  const commonKeys = ["operationId", "operation", "state", "projectId", "lifecycleRevision", "statusSecretHash"];
  const keys = value.state === "reserved"
    ? [...commonKeys, "projectRevision", "priorEntry", "sourceIdentity"]
    : value.state === "cleanup-pending" ? [...commonKeys, "projectRevision", "sourceIdentity"]
    : value.state === "complete" ? [...commonKeys, "projectRevision", "completedAt"] : commonKeys;
  requireExactKeys(value, keys, "deletion evidence");
  if (typeof value.operationId !== "string" || !OPERATION_ID_PATTERN.test(value.operationId)) {
    throw new TypeError("deletion operationId must be opaque");
  }
  if (value.operation !== "delete") throw new TypeError("deletion operation must be delete");
  if (typeof value.projectId !== "string" || !PROJECT_ID_PATTERN.test(value.projectId)) {
    throw new TypeError("deletion projectId must be opaque");
  }
  if (typeof value.statusSecretHash !== "string" || !HASH_PATTERN.test(value.statusSecretHash)) {
    throw new TypeError("deletion statusSecretHash must be lowercase SHA-256 hex");
  }
  const base = {
    operationId: value.operationId,
    operation: "delete" as const,
    projectId: value.projectId,
    lifecycleRevision: requirePositiveInteger(value.lifecycleRevision, "deletion lifecycleRevision"),
    statusSecretHash: value.statusSecretHash,
  };
  if (value.state === "cleanup-pending") {
    if (typeof value.projectRevision !== "string" || !HASH_PATTERN.test(value.projectRevision)) {
      throw new TypeError("deletion project revision must be lowercase SHA-256 hex");
    }
    return {
      ...base,
      state: "cleanup-pending",
      projectRevision: value.projectRevision,
      sourceIdentity: parseIdentity(value.sourceIdentity),
    };
  }
  if (value.state === "complete") {
    if (typeof value.projectRevision !== "string" || !HASH_PATTERN.test(value.projectRevision)) {
      throw new TypeError("deletion project revision must be lowercase SHA-256 hex");
    }
    return {
      ...base,
      state: "complete",
      projectRevision: value.projectRevision,
      completedAt: requireTimestamp(value.completedAt, "completedAt"),
    };
  }
  if (value.state !== "reserved") {
    throw new TypeError("deletion evidence state must be reserved, cleanup-pending, or complete");
  }
  if (typeof value.projectRevision !== "string" || !HASH_PATTERN.test(value.projectRevision)) {
    throw new TypeError("deletion project revision must be lowercase SHA-256 hex");
  }
  const priorEntry = parseEntry(value.priorEntry);
  if (priorEntry.id !== value.projectId || priorEntry.lifecycleRevision !== base.lifecycleRevision) {
    throw new TypeError("deletion reservation must match its prior entry");
  }
  return {
    ...base,
    state: "reserved",
    projectRevision: value.projectRevision,
    priorEntry,
    sourceIdentity: parseIdentity(value.sourceIdentity),
  };
}

export function parseManagedProjectCatalog(
  value: unknown,
  createIdNamespace: () => string = () => randomUUID().replaceAll("-", "").slice(0, 16),
): ManagedProjectCatalogDocument {
  if (!isRecord(value)) throw new TypeError("managed project catalog must be an object");
  if (value.version === 1) {
    requireExactKeys(value, ["version", "entries"], "managed project catalog");
    if (!Array.isArray(value.entries)) throw new TypeError("managed project catalog entries must be an array");
    const entries = value.entries.map((entry) => parseEntry(entry, true));
    const idNamespace = createMigrationNamespace(entries.map((entry) => entry.id), createIdNamespace);
    return validateCatalog({
      version: 2,
      generation: 0,
      idNamespace,
      nextProjectOrdinal: 1,
      entries,
      deletions: [],
    });
  }
  if (isAbandonedLifecycleCatalog(value)) {
    requireExactKeys(
      value,
      ["version", "generation", "entries", "lifecycleCommits"],
      "managed project catalog",
    );
    if (!Number.isSafeInteger(value.generation) || (value.generation as number) < 0) {
      throw new TypeError("managed project catalog generation must be a non-negative integer");
    }
    if (!Array.isArray(value.entries)) {
      throw new TypeError("managed project catalog entries must be an array");
    }
    if (!Array.isArray(value.lifecycleCommits) || value.lifecycleCommits.length !== 0) {
      throw new TypeError("abandoned lifecycle catalog must not contain purge evidence");
    }
    const entries = value.entries.map((entry) => parseEntry(entry));
    const idNamespace = createMigrationNamespace(entries.map((entry) => entry.id), createIdNamespace);
    return validateCatalog({
      version: 2,
      generation: value.generation as number,
      idNamespace,
      nextProjectOrdinal: 1,
      entries,
      deletions: [],
    });
  }
  requireExactKeys(value, ["version", "generation", "idNamespace", "nextProjectOrdinal", "entries", "deletions"], "managed project catalog");
  if (value.version !== 2) throw new TypeError("managed project catalog version must be 1 or 2");
  if (!Number.isSafeInteger(value.generation) || (value.generation as number) < 0) {
    throw new TypeError("managed project catalog generation must be a non-negative integer");
  }
  if (typeof value.idNamespace !== "string" || !ID_NAMESPACE_PATTERN.test(value.idNamespace)) {
    throw new TypeError("managed project catalog idNamespace must be 16 lowercase hex characters");
  }
  const nextProjectOrdinal = requirePositiveInteger(value.nextProjectOrdinal, "nextProjectOrdinal");
  if (!Array.isArray(value.entries)) throw new TypeError("managed project catalog entries must be an array");
  if (!Array.isArray(value.deletions)) throw new TypeError("managed project catalog deletions must be an array");
  return validateCatalog({
    version: 2,
    generation: value.generation as number,
    idNamespace: value.idNamespace,
    nextProjectOrdinal,
    entries: value.entries.map((entry) => parseEntry(entry)),
    deletions: value.deletions.map(parseDeletion),
  });
}

function validateCatalog(catalog: ManagedProjectCatalogDocument): ManagedProjectCatalogDocument {
  if (!ID_NAMESPACE_PATTERN.test(catalog.idNamespace)) {
    throw new TypeError("managed project catalog idNamespace must be 16 lowercase hex characters");
  }
  requirePositiveInteger(catalog.nextProjectOrdinal, "nextProjectOrdinal");
  const ids = new Set(catalog.entries.map((entry) => entry.id));
  if (ids.size !== catalog.entries.length) throw new TypeError("managed project catalog entries must not duplicate ids");
  const operationIds = new Set(catalog.deletions.map((evidence) => evidence.operationId));
  if (operationIds.size !== catalog.deletions.length) {
    throw new TypeError("managed project catalog deletions must not duplicate operation ids");
  }
  const projectIds = new Set(catalog.deletions.map((evidence) => evidence.projectId));
  if (projectIds.size !== catalog.deletions.length) {
    throw new TypeError("managed project catalog must not contain multiple deletion records for one project");
  }
  const allocatedIds = [...catalog.entries.map((entry) => entry.id), ...projectIds];
  for (const id of allocatedIds) {
    const ordinal = projectOrdinalForNamespace(id, catalog.idNamespace);
    if (ordinal !== undefined && ordinal >= catalog.nextProjectOrdinal) {
      throw new TypeError("managed project catalog nextProjectOrdinal must be above every known id");
    }
  }
  for (const evidence of catalog.deletions) {
    const active = catalog.entries.find((entry) => entry.id === evidence.projectId);
    if (evidence.state === "reserved") {
      if (!active) throw new TypeError("deletion reservation must reference a live entry");
      if (!entriesMatch(active, evidence.priorEntry)) {
        throw new TypeError("deletion reservation prior entry must match the live entry");
      }
    } else if (active) {
      throw new TypeError("terminal deletion evidence must not reference a live entry");
    }
  }
  if (catalog.deletions.filter((evidence) => evidence.state !== "complete").length > MAX_PENDING_DELETIONS) {
    throw new TypeError("managed project catalog exceeds pending deletion limit");
  }
  if (catalog.deletions.filter((evidence) => evidence.state === "complete").length > MAX_COMPLETED_DELETIONS) {
    throw new TypeError("managed project catalog exceeds completed deletion limit");
  }
  return catalog;
}

function entriesMatch(
  left: ActiveManagedProjectCatalogEntry,
  right: ActiveManagedProjectCatalogEntry,
): boolean {
  return left.id === right.id
    && left.directoryName === right.directoryName
    && left.name === right.name
    && left.lifecycle === right.lifecycle
    && left.lifecycleRevision === right.lifecycleRevision
    && left.createdAt === right.createdAt
    && left.updatedAt === right.updatedAt;
}

function requireOperationId(operationId: string): void {
  if (!OPERATION_ID_PATTERN.test(operationId)) {
    throw new TypeError("Deletion operation id must be opaque");
  }
}

function trimCompletedDeletions(
  deletions: ManagedProjectDeletionEvidence[],
): ManagedProjectDeletionEvidence[] {
  const pending = deletions.filter((evidence) => evidence.state !== "complete");
  const completed = deletions
    .filter((evidence): evidence is ManagedProjectDeletionComplete => evidence.state === "complete")
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt)
      || right.operationId.localeCompare(left.operationId))
    .slice(0, MAX_COMPLETED_DELETIONS);
  return [...pending, ...completed];
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
    }));
  const deletions = [...catalog.deletions]
    .sort((left, right) => left.operationId.localeCompare(right.operationId));
  return `${JSON.stringify({
    version: 2,
    generation: catalog.generation,
    idNamespace: catalog.idNamespace,
    nextProjectOrdinal: catalog.nextProjectOrdinal,
    entries,
    deletions,
  }, null, 2)}\n`;
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

  async #readPersisted(): Promise<{ catalog: ManagedProjectCatalogDocument; migrated: boolean }> {
    const value = JSON.parse(await readFile(this.config.catalogPath, "utf8")) as unknown;
    return {
      catalog: parseManagedProjectCatalog(value, this.#createIdNamespace),
      migrated: isRecord(value) && (value.version === 1 || isAbandonedLifecycleCatalog(value)),
    };
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
        return (await this.#readPersisted()).catalog;
      }
    }
  }

  async #withLock<T>(operation: () => Promise<T>): Promise<T> {
    await ensureManagedStorageRoot(this.config);
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
