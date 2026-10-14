// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ProjectImportDialog.tsx", import.meta.url), "utf8");

describe("ProjectImportDialog entry choices", () => {
  it("composes the shared dialog contract instead of implementing another modal", () => {
    expect(source).toContain("<DialogShell");
    expect(source).toContain('initialFocus="heading"');
    expect(source).toContain("focusResetKey={state.status}");
    expect(source).toContain('closeLabel="Close project import"');
    expect(source).not.toContain('role="dialog"');
    expect(source).not.toContain("fixed inset-0 z-50");
  });

  it("keeps complete project import and Capture folder inside the one Import entry", () => {
    expect(source).toContain("Project folder or archive");
    expect(source).toContain("Capture folder");
    expect(source).toContain("onChooseCapture");
    expect(source).toContain("Folder");
    expect(source).toContain("Project ZIP");
    expect(source).toContain("Standalone JSON");
    expect(source.match(/flex h-full flex-col items-start justify-start/g)).toHaveLength(3);
  });
});
