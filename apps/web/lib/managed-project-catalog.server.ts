// SPDX-License-Identifier: Apache-2.0
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
