// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { createExportOperationId, parseExportProgress } from "./export-progress.js";

describe("export progress client contract", () => {
  it("creates opaque ids and parses bounded progress", () => {
    const operationId = createExportOperationId(new Uint8Array(16).fill(0xab));
    expect(operationId).toBe(`export_${"ab".repeat(16)}`);
    expect(parseExportProgress({ operationId, phase: "rendering", completed: 2, total: 3 }))
      .toEqual({ operationId, phase: "rendering", completed: 2, total: 3 });
  });

  it("rejects malformed and impossible progress", () => {
    expect(parseExportProgress({ operationId: "../escape", phase: "rendering", completed: 1, total: 1 }))
      .toBeUndefined();
    expect(parseExportProgress({
      operationId: `export_${"ab".repeat(16)}`,
      phase: "rendering",
      completed: 2,
      total: 1,
    })).toBeUndefined();
  });
});
