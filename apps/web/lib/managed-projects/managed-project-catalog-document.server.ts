// SPDX-License-Identifier: Apache-2.0
import { hasExactKeys, isRecord } from "@web/lib/json-guards.js";

export const PROJECT_ID_PATTERN = /^project_[0-9a-f]{32}$/;
const OPERATION_ID_PATTERN = /^operation_[0-9a-f]{32}$/;
const ID_NAMESPACE_PATTERN = /^[0-9a-f]{16}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
export const MAX_PENDING_DELETIONS = 1_000;
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
  version: 1;
  generation: number;
  idNamespace: string;
  nextProjectOrdinal: number;
  entries: ManagedProjectCatalogEntry[];
  deletions: ManagedProjectDeletionEvidence[];
}

function requireExactKeys(value: Record<string, unknown>, keys: readonly string[], context: string): void {
  if (!hasExactKeys(value, keys)) {
    throw new TypeError(`${context} contains unknown or missing properties`);
  }
}

export function requireTimestamp(value: unknown, property: string): string {
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

export function incrementSafeInteger(value: number, property: string): number {
  if (!Number.isSafeInteger(value) || value >= Number.MAX_SAFE_INTEGER) {
    throw new Error(`${property} cannot be incremented safely`);
  }
  return value + 1;
}

export function projectOrdinalForNamespace(id: string, namespace: string): number | undefined {
  const prefix = `project_${namespace}`;
  if (!id.startsWith(prefix)) return undefined;
  const ordinal = BigInt(`0x${id.slice(prefix.length)}`);
  if (ordinal > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Managed project id namespace cannot advance safely past an existing id");
  }
  return Number(ordinal);
}

export function parseEntry(value: unknown): ActiveManagedProjectCatalogEntry {
  if (!isRecord(value)) throw new TypeError("catalog entry must be an object");
  const lifecycle = value.lifecycle;
  requireExactKeys(
    value,
    ["id", "directoryName", "name", "lifecycle", "lifecycleRevision", "createdAt", "updatedAt"],
    "catalog entry",
  );
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
    lifecycleRevision: requirePositiveInteger(value.lifecycleRevision, "catalog entry lifecycleRevision"),
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

export function parseDeletion(value: unknown): ManagedProjectDeletionEvidence {
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
): ManagedProjectCatalogDocument {
  if (!isRecord(value)) throw new TypeError("managed project catalog must be an object");
  requireExactKeys(value, ["version", "generation", "idNamespace", "nextProjectOrdinal", "entries", "deletions"], "managed project catalog");
  if (value.version !== 1) throw new TypeError("managed project catalog version must be 1");
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
    version: 1,
    generation: value.generation as number,
    idNamespace: value.idNamespace,
    nextProjectOrdinal,
    entries: value.entries.map((entry) => parseEntry(entry)),
    deletions: value.deletions.map(parseDeletion),
  });
}

export function validateCatalog(catalog: ManagedProjectCatalogDocument): ManagedProjectCatalogDocument {
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

export function entriesMatch(
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

export function requireOperationId(operationId: string): void {
  if (!OPERATION_ID_PATTERN.test(operationId)) {
    throw new TypeError("Deletion operation id must be opaque");
  }
}

export function trimCompletedDeletions(
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
    version: 1,
    generation: catalog.generation,
    idNamespace: catalog.idNamespace,
    nextProjectOrdinal: catalog.nextProjectOrdinal,
    entries,
    deletions,
  }, null, 2)}\n`;
}
