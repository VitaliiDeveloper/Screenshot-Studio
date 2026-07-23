// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ToolRail.tsx", import.meta.url), "utf8");

describe("ToolRail project navigation", () => {
  it("places the Projects home action at the bottom of the Workspace rail", () => {
    expect(source).toContain("House");
    expect(source).toContain('label="Projects"');
    expect(source).toContain("onOpenProjects");
    expect(source).toContain("projectsBusy");
    expect(source).toContain("mt-auto");
  });
});
