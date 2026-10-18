// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { ExportProgressRegistry } from "./export-progress.server.js";

const operationId = `export_${"ab".repeat(16)}`;

describe("ExportProgressRegistry", () => {
  it("reports render progress and retains a short-lived terminal state", () => {
    let now = 1_000;
    const registry = new ExportProgressRegistry({ now: () => now, activeTtlMs: 1_000, finalTtlMs: 100 });

    registry.begin(operationId, 3);
    registry.update(operationId, "rendering", 1, 3);
    expect(registry.get(operationId)).toEqual({ operationId, phase: "rendering", completed: 1, total: 3 });

    registry.update(operationId, "packaging", 3, 3);
    registry.finish(operationId, "ready");
    expect(registry.get(operationId)).toEqual({ operationId, phase: "ready", completed: 3, total: 3 });

    now += 101;
    expect(registry.get(operationId)).toBeUndefined();
  });

  it("rejects malformed ids, collisions, and unbounded admission", () => {
    const registry = new ExportProgressRegistry({ maxEntries: 1 });
    expect(() => registry.begin("../escape", 1)).toThrow(/invalid export operation id/i);
    registry.begin(operationId, 1);
    expect(() => registry.begin(operationId, 1)).toThrow(/already exists/i);
    expect(() => registry.begin(`export_${"cd".repeat(16)}`, 1)).toThrow(/too many/i);
  });

  it("records a stop request only while the export is running", () => {
    const registry = new ExportProgressRegistry();
    expect(registry.requestStop(operationId)).toBe(false);
    registry.begin(operationId, 2);
    expect(registry.stopRequested(operationId)).toBe(false);
    expect(registry.requestStop(operationId)).toBe(true);
    expect(registry.stopRequested(operationId)).toBe(true);
    registry.finish(operationId, "ready");
    expect(registry.requestStop(operationId)).toBe(false);
  });
});
