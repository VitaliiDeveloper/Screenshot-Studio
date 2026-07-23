// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const creationDialog = readFileSync(
  new URL("./ProjectCreationDialog.tsx", import.meta.url),
  "utf8",
);
const dialogShell = readFileSync(
  new URL("../editor-ui/DialogShell.tsx", import.meta.url),
  "utf8",
);

describe("project creation UI structure", () => {
  it("delegates modal behavior to the shared dialog shell", () => {
    expect(creationDialog).toContain("<DialogShell");
    expect(creationDialog).not.toContain('document.addEventListener("keydown"');
    expect(creationDialog).not.toContain('role="dialog"');
    expect(dialogShell).toContain("initialFocus");
    expect(dialogShell).toContain("[role='menu']");
    expect(dialogShell).toContain("active === headingRef.current");
  });

  it("uses semantic color contracts instead of direct palette classes", () => {
    expect(creationDialog).not.toMatch(/(?:slate|blue|amber|red|indigo)-\d/);
    expect(dialogShell).not.toMatch(/(?:slate|blue|amber|red|indigo)-\d/);
  });

  it("uses the core project name limit", () => {
    expect(creationDialog).toContain("PROJECT_NAME_MAX_LENGTH");
    expect(creationDialog).toContain("maxLength={PROJECT_NAME_MAX_LENGTH}");
    expect(creationDialog).not.toContain("maxLength={120}");
  });
});
