// SPDX-License-Identifier: Apache-2.0
import {
  parseActiveManagedProjectCatalogEntry,
  type ActiveManagedProjectCatalogEntry,
  type ManagedDirectoryIdentity,
  type ManagedProjectDeletionEvidence,
} from "./managed-project-catalog-document.server.js";
import { hasExactKeys, isRecord } from "@web/lib/json-guards.js";

export const HASH_PATTERN = /^[0-9a-f]{64}$/;

export interface ManagedProjectDeleteIntent {
  version: 1;
  operation: "delete";
  operationId: string;
  id: string;
  expectedLifecycleRevision: number;
  expectedProjectRevision: string;
  statusSecretHash: string;
  priorEntry: ActiveManagedProjectCatalogEntry;
  sourceIdentity: ManagedDirectoryIdentity;
  tombstoneName: string;
  tombstoneIdentity: ManagedDirectoryIdentity | null;
  phase: "prepared" | "quarantined" | "catalog-removed" | "tombstone-removed";
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  if (!hasExactKeys(value, expected)) {
    throw new TypeError("Invalid managed deletion recovery intent properties");
  }
}

export function sameIdentity(left: ManagedDirectoryIdentity, right: ManagedDirectoryIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

export function sameEntry(left: ActiveManagedProjectCatalogEntry, right: ActiveManagedProjectCatalogEntry): boolean {
  return left.id === right.id && left.directoryName === right.directoryName && left.name === right.name
    && left.lifecycle === right.lifecycle && left.lifecycleRevision === right.lifecycleRevision
    && left.createdAt === right.createdAt && left.updatedAt === right.updatedAt;
}

function parseIdentity(value: unknown, context: string): ManagedDirectoryIdentity {
  if (!isRecord(value)) throw new TypeError(`Invalid ${context} identity`);
  exactKeys(value, ["device", "inode"]);
  if (typeof value.device !== "string" || !/^\d+$/.test(value.device)
    || typeof value.inode !== "string" || !/^\d+$/.test(value.inode)) {
    throw new TypeError(`Invalid ${context} identity`);
  }
  return { device: value.device, inode: value.inode };
}

export function tombstoneName(projectId: string, operationId: string): string {
  return `${projectId}.${operationId}`;
}

export function parseIntent(
  value: unknown,
  evidence: ManagedProjectDeletionEvidence,
): ManagedProjectDeleteIntent {
  if (!isRecord(value)) throw new TypeError("Invalid managed deletion recovery intent");
  exactKeys(value, [
    "version", "operation", "operationId", "id", "expectedLifecycleRevision",
    "expectedProjectRevision", "statusSecretHash", "priorEntry", "sourceIdentity",
    "tombstoneName", "tombstoneIdentity", "phase",
  ]);
  if (value.version !== 1 || value.operation !== "delete"
    || value.operationId !== evidence.operationId || value.id !== evidence.projectId
    || value.expectedLifecycleRevision !== evidence.lifecycleRevision
    || typeof value.expectedProjectRevision !== "string" || !HASH_PATTERN.test(value.expectedProjectRevision)
    || value.statusSecretHash !== evidence.statusSecretHash
    || value.tombstoneName !== tombstoneName(evidence.projectId, evidence.operationId)
    || !["prepared", "quarantined", "catalog-removed", "tombstone-removed"].includes(String(value.phase))) {
    throw new TypeError("Managed deletion recovery intent does not match catalog evidence");
  }
  const priorEntry = parseActiveManagedProjectCatalogEntry(value.priorEntry);
  const sourceIdentity = parseIdentity(value.sourceIdentity, "source");
  const tombstoneIdentity = value.tombstoneIdentity === null
    ? null
    : parseIdentity(value.tombstoneIdentity, "tombstone");
  if (evidence.state === "reserved" && (value.expectedProjectRevision !== evidence.projectRevision
    || !sameEntry(priorEntry, evidence.priorEntry)
    || !sameIdentity(sourceIdentity, evidence.sourceIdentity))) {
    throw new TypeError("Managed deletion recovery intent does not match reservation evidence");
  }
  if (evidence.state === "cleanup-pending" && (value.expectedProjectRevision !== evidence.projectRevision
    || !sameIdentity(sourceIdentity, evidence.sourceIdentity))) {
    throw new TypeError("Managed deletion recovery intent does not match pending evidence");
  }
  return {
    version: 1,
    operation: "delete",
    operationId: evidence.operationId,
    id: evidence.projectId,
    expectedLifecycleRevision: evidence.lifecycleRevision,
    expectedProjectRevision: value.expectedProjectRevision,
    statusSecretHash: evidence.statusSecretHash,
    priorEntry,
    sourceIdentity,
    tombstoneName: value.tombstoneName,
    tombstoneIdentity,
    phase: value.phase as ManagedProjectDeleteIntent["phase"],
  };
}
