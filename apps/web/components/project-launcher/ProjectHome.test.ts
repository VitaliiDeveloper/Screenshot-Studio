// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ProjectHome.tsx", import.meta.url), "utf8");

describe("ProjectHome archive action", () => {
  it("offers the explicitly named action only for managed projects", () => {
    expect(source).toContain('project.sourceKind === "managed-project"');
    expect(source).toContain("Export project archive");
    expect(source).toContain("requestProjectArchive");
    expect(source).toContain("requestProjectArchive(project.projectId)");
    expect(source).toContain("downloadProjectArchive");
  });

  it("keeps project archive and rendered store-image export unambiguous", () => {
    expect(source).toContain("portable backup for later project import");
    expect(source).toContain("separate from rendered store-image export");
    expect(source).toContain('role="alert"');
  });
});
