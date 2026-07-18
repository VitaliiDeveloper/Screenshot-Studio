// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ProjectLauncher.tsx", import.meta.url), "utf8");

describe("ProjectLauncher import integration", () => {
  it("keeps the existing active-session redirect and routes successful import to Project Home", () => {
    expect(source).toContain('router.replace("/home")');
    expect(source).toContain('router.push("/home")');
    expect(source).toContain("router.refresh()");
  });

  it("aborts only the active browser transfer and preserves typed resource guidance", () => {
    expect(source).toContain("new AbortController()");
    expect(source).toContain("importControllerRef.current?.abort()");
    expect(source).toContain("ProjectImportClientError");
    expect(source).toContain("caught.missingResources");
  });

  it("keeps the dialog mounted through its exit lifecycle and respects reduced motion", () => {
    expect(source).toContain("requestLauncherDialogExit");
    expect(source).toContain("launcherDialogExitDelay");
    expect(source).toContain("prefers-reduced-motion: reduce");
    expect(source).toContain("dialogClosing={dialogClosing}");
    expect(source).toContain("publishingRef.current || importState.status");
    expect(source).toContain('exitActionRef.current === "cancel"');
  });

  it("never exposes browser local-path activation", () => {
    expect(source).not.toContain("PROJECT_PATH");
    expect(source).not.toContain('type="text"');
    expect(source).not.toContain("requestedPath");
  });
});
