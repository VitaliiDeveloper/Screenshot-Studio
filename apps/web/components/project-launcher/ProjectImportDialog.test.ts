// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ProjectImportDialog.tsx", import.meta.url), "utf8");

describe("ProjectImportDialog entry choices", () => {
  it("keeps complete project import and Capture folder inside the one Import entry", () => {
    expect(source).toContain("Project folder or archive");
    expect(source).toContain("Capture folder");
    expect(source).toContain("onChooseCapture");
    expect(source).toContain("Folder");
    expect(source).toContain("Project ZIP");
    expect(source).toContain("Standalone JSON");
  });
});
