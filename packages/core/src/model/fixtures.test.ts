// SPDX-License-Identifier: Apache-2.0
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { Project } from "./schema.js";

const fixturesRoot = fileURLToPath(new URL("../../../../fixtures/", import.meta.url));

async function projectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return projectFiles(path);
    return entry.name === "app-store-screenshots.json" ? [path] : [];
  }));
  return nested.flat().sort();
}

describe("tracked project fixtures", () => {
  it("all validate directly against the complete strict schema", async () => {
    const failures: string[] = [];
    const paths = await projectFiles(fixturesRoot);
    expect(paths.length).toBeGreaterThan(0);

    for (const path of paths) {
      const raw: unknown = JSON.parse(await readFile(path, "utf8"));
      const result = Project.safeParse(raw);
      if (!result.success) {
        failures.push([
          relative(fixturesRoot, path),
          ...result.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`),
        ].join("\n"));
      }
    }

    expect(failures).toEqual([]);
  });
});
