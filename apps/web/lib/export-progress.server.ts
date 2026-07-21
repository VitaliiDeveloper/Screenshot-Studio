// SPDX-License-Identifier: Apache-2.0
import {
  EXPORT_OPERATION_ID_PATTERN,
  type ExportProgressPhase,
  type ExportProgressSnapshot,
} from "./export-progress.js";

interface ExportProgressEntry extends ExportProgressSnapshot {
  expiresAt: number;
}

interface ExportProgressRegistryOptions {
  now?: () => number;
  activeTtlMs?: number;
  finalTtlMs?: number;
  maxEntries?: number;
}

export class ExportProgressRegistry {
  readonly #entries = new Map<string, ExportProgressEntry>();
  readonly #now: () => number;
  readonly #activeTtlMs: number;
  readonly #finalTtlMs: number;
  readonly #maxEntries: number;

  constructor({
    now = Date.now,
    activeTtlMs = 60 * 60 * 1_000,
    finalTtlMs = 2 * 60 * 1_000,
    maxEntries = 64,
  }: ExportProgressRegistryOptions = {}) {
    this.#now = now;
    this.#activeTtlMs = activeTtlMs;
    this.#finalTtlMs = finalTtlMs;
    this.#maxEntries = maxEntries;
  }

  begin(operationId: string, total: number): void {
    this.#assertOperationId(operationId);
    this.#prune();
    if (this.#entries.has(operationId)) throw new Error("Export operation already exists");
    if (this.#entries.size >= this.#maxEntries) throw new Error("Too many export operations are active");
    this.#write(operationId, "preparing", 0, total, this.#activeTtlMs);
  }

  update(
    operationId: string,
    phase: Extract<ExportProgressPhase, "rendering" | "packaging" | "finalizing">,
    completed: number,
    total: number,
  ): void {
    const current = this.#entries.get(operationId);
    if (!current || current.phase === "ready" || current.phase === "failed") return;
    this.#write(operationId, phase, completed, total, this.#activeTtlMs);
  }

  finish(operationId: string, phase: Extract<ExportProgressPhase, "ready" | "failed">): void {
    const current = this.#entries.get(operationId);
    if (!current) return;
    this.#write(operationId, phase, current.completed, current.total, this.#finalTtlMs);
  }

  get(operationId: string): ExportProgressSnapshot | undefined {
    this.#assertOperationId(operationId);
    this.#prune();
    const entry = this.#entries.get(operationId);
    if (!entry) return undefined;
    return {
      operationId: entry.operationId,
      phase: entry.phase,
      completed: entry.completed,
      total: entry.total,
    };
  }

  #write(
    operationId: string,
    phase: ExportProgressPhase,
    completed: number,
    total: number,
    ttlMs: number,
  ): void {
    this.#entries.set(operationId, {
      operationId,
      phase,
      completed,
      total,
      expiresAt: this.#now() + ttlMs,
    });
  }

  #prune(): void {
    const now = this.#now();
    for (const [operationId, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(operationId);
    }
  }

  #assertOperationId(operationId: string): void {
    if (!EXPORT_OPERATION_ID_PATTERN.test(operationId)) {
      throw new TypeError("Invalid export operation id");
    }
  }
}

const processState = globalThis as typeof globalThis & {
  __screenshotStudioExportProgressRegistry?: ExportProgressRegistry;
};

export const exportProgressRegistry = processState.__screenshotStudioExportProgressRegistry
  ??= new ExportProgressRegistry();
