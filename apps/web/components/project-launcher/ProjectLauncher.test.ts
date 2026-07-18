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

  it("never exposes browser local-path activation", () => {
    expect(source).not.toContain("PROJECT_PATH");
    expect(source).not.toContain('type="text"');
    expect(source).not.toContain("requestedPath");
  });
});
