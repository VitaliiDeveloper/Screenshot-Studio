// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { runCheckCommand, type CheckReport } from "@screenshot-studio/cli/check-command";
import { ISSUES_FIXTURE_IDS, writeIssuesFixture } from "./support/issues-fixture.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const directory = mkdtempSync(join(tmpdir(), "check-command-"));

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("screenshots check --render", () => {
  it("reports the editor's Issues for the shared fixture through the export render host", async () => {
    const project = writeIssuesFixture(directory);

    const result = await runCheckCommand(
      { project, json: "true", render: "true" },
      resolve(repoRoot, "store-specs.json"),
    );

    const report = JSON.parse(result.output) as CheckReport;
    expect(result.exitCode).toBe(1);
    expect(report).toMatchObject({ textMeasured: true, counts: { blockers: 2, warnings: 3 } });
    expect(report.issues.map((issue) => issue.id)).toEqual([...ISSUES_FIXTURE_IDS.blockers, ...ISSUES_FIXTURE_IDS.warnings]);
  }, 180_000);
});
