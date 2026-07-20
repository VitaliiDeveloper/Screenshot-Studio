// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ProjectCreationDialog.tsx", import.meta.url), "utf8");

describe("ProjectCreationDialog presentation", () => {
  it("keeps publication geometry stable through the animated handoff", () => {
    expect(source).toContain(
      'const busy = state.status === "creating" || state.status === "completing"',
    );
    expect(source).toContain(
      'motion={state.status === "completing" ? "closing" : "open"}',
    );
    expect(source).not.toContain("disabled:opacity-75");
    expect(source).toContain("aria-hidden={busy || undefined}");
    expect(source).toContain("aria-disabled={busy || undefined}");
    expect(source).toContain("tabIndex={busy ? -1 : undefined}");
    expect(source).toContain('busy ? "invisible"');
  });

  it("keeps creation progress stable in the submit button without transient messages", () => {
    expect(source).toContain('busy ? "Creating project…"');
    expect(source).not.toContain("useState");
    expect(source).not.toContain("useEffect");
    expect(source).not.toContain("editorUi.statusProgress");
    expect(source).not.toContain("Validating and publishing the managed project…");
    expect(source).not.toContain("Finishing project setup…");
    expect(source).not.toContain("Creating your project…");
  });
});
