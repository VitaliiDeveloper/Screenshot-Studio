// SPDX-License-Identifier: Apache-2.0
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface PackageManifest {
  scripts: Record<string, string>;
}

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as PackageManifest;
const e2eFiles = readdirSync(resolve(root, "e2e"))
  .filter((file) => file.endsWith(".test.ts"))
  .sort();

const leafGroups = Object.entries(manifest.scripts)
  .filter(([name, command]) => name.startsWith("test:e2e:") && command.startsWith("vitest run"));

function listedFiles(command: string): string[] {
  return [...command.matchAll(/e2e\/([^ ]+\.test\.ts)/g)].map((match) => match[1]!);
}

describe("E2E group ownership", () => {
  it("assigns every E2E file to exactly one leaf group", () => {
    const owners = new Map(e2eFiles.map((file) => [file, [] as string[]]));

    for (const [group, command] of leafGroups) {
      for (const file of listedFiles(command)) {
        expect(owners.has(file), `${group} references missing e2e/${file}`).toBe(true);
        owners.get(file)!.push(group);
      }
    }

    expect(
      [...owners].filter(([, groups]) => groups.length !== 1),
      "each E2E file must have exactly one leaf-group owner",
    ).toEqual([]);
  });

  it("keeps aggregate groups free of duplicated file lists", () => {
    const aggregateGroups = Object.entries(manifest.scripts)
      .filter(([name, command]) => name.startsWith("test:e2e:") && !command.startsWith("vitest run"));

    expect(aggregateGroups.filter(([, command]) => listedFiles(command).length > 0)).toEqual([]);
  });
});
