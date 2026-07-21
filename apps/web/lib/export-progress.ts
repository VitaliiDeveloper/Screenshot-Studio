// SPDX-License-Identifier: Apache-2.0

export const EXPORT_OPERATION_ID_PATTERN = /^export_[a-f0-9]{32}$/u;

export type ExportProgressPhase =
  | "preparing"
  | "rendering"
  | "packaging"
  | "finalizing"
  | "ready"
  | "failed";

export interface ExportProgressSnapshot {
  operationId: string;
  phase: ExportProgressPhase;
  completed: number;
  total: number;
}

const phases = new Set<ExportProgressPhase>([
  "preparing",
  "rendering",
  "packaging",
  "finalizing",
  "ready",
  "failed",
]);

export function createExportOperationId(randomBytes?: Uint8Array): string {
  const bytes = randomBytes ?? crypto.getRandomValues(new Uint8Array(16));
  if (bytes.length !== 16) throw new TypeError("Export operation ids require 16 random bytes");
  return `export_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function parseExportProgress(value: unknown): ExportProgressSnapshot | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Partial<ExportProgressSnapshot>;
  if (
    typeof candidate.operationId !== "string"
    || !EXPORT_OPERATION_ID_PATTERN.test(candidate.operationId)
    || typeof candidate.phase !== "string"
    || !phases.has(candidate.phase as ExportProgressPhase)
    || !Number.isInteger(candidate.completed)
    || !Number.isInteger(candidate.total)
    || candidate.completed! < 0
    || candidate.total! < 0
    || candidate.completed! > candidate.total!
  ) return undefined;
  return candidate as ExportProgressSnapshot;
}
