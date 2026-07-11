// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  EXPECTED_PACK_FILES,
  isForbiddenRuntimeEntry,
  validatePackFiles,
} from "./release-audit.mjs";

describe("release package audit", () => {
  it("pins the packed file allowlist", () => {
    expect(() => validatePackFiles(EXPECTED_PACK_FILES)).not.toThrow();
    expect(() => validatePackFiles([...EXPECTED_PACK_FILES, "src/index.ts"])).toThrow(/Unexpected package files/);
  });

  it("rejects native or platform-labelled embedded runtime files", () => {
    expect(isForbiddenRuntimeEntry("node_modules/example/addon.node")).toBe(true);
    expect(isForbiddenRuntimeEntry("node_modules/example/lib-linux-x64.js")).toBe(true);
    expect(isForbiddenRuntimeEntry("node_modules/react/index.js")).toBe(false);
  });
});
