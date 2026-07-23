// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const hookSource = readFileSync(new URL("./useManagedProjectDeletion.ts", import.meta.url), "utf8");
const homeSource = readFileSync(new URL("./ProjectHome.tsx", import.meta.url), "utf8");
const launcherSource = readFileSync(new URL("./ProjectLauncher.tsx", import.meta.url), "utf8");

describe("useManagedProjectDeletion", () => {
  it("keeps the archive-first controller shared and resettable", () => {
    expect(hookSource).toContain("export function useManagedProjectDeletion");
    expect(hookSource).toContain("requestProjectArchive");
    expect(hookSource).toContain("downloadProjectArchive");
    expect(hookSource).toContain('status: "archive-error"');
    expect(hookSource).toContain("setDialog(null)");
    expect(hookSource).toContain("onDeleted(projectId)");
  });

  it("is owned by the Projects gallery instead of the read-only Project Info view", () => {
    expect(launcherSource).toContain("useManagedProjectDeletion");
    expect(homeSource).not.toContain("useManagedProjectDeletion");
    expect(homeSource).not.toContain("advanceProjectHomeDeletion({");
  });
});
