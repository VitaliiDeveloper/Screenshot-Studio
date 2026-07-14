// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface PackageManifest {
  scripts: Record<string, string>;
}

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as PackageManifest;
function discoverE2eFiles(directory: string, prefix = ""): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return discoverE2eFiles(resolve(directory, entry.name), relativePath);
    return entry.isFile() && entry.name.endsWith(".test.ts") ? [relativePath] : [];
  }).sort();
}

function referencedE2eScripts(command: string): string[] {
  return [...command.matchAll(/\bpnpm\s+(test:e2e(?::[a-z0-9-]+)*)\b/gi)]
    .map((match) => match[1]!);
}

function reachableE2eScripts(scripts: Record<string, string>, rootScript: string): Set<string> {
  const reachable = new Set<string>();
  const visiting = new Set<string>();

  const visit = (name: string, path: string[]): void => {
    if (visiting.has(name)) throw new Error(`E2E script cycle: ${[...path, name].join(" -> ")}`);
    if (reachable.has(name)) return;
    const command = scripts[name];
    if (command === undefined) {
      throw new Error(`Missing E2E script ${name} referenced by ${path.at(-1) ?? rootScript}`);
    }

    visiting.add(name);
    for (const referenced of referencedE2eScripts(command)) visit(referenced, [...path, name]);
    visiting.delete(name);
    reachable.add(name);
  };

  visit(rootScript, []);
  return reachable;
}

const e2eFiles = discoverE2eFiles(resolve(root, "e2e"));

const leafGroups = Object.entries(manifest.scripts)
  .filter(([name, command]) => name.startsWith("test:e2e:") && command.startsWith("vitest run"));

function listedFiles(command: string): string[] {
  return [...command.matchAll(/e2e\/([^ ]+\.test\.ts)/g)].map((match) => match[1]!);
}

describe("E2E group ownership", () => {
  it("discovers E2E tests recursively", () => {
    const directory = mkdtempSync(join(tmpdir(), "e2e-groups-"));
    try {
      mkdirSync(resolve(directory, "nested"));
      writeFileSync(resolve(directory, "root.test.ts"), "");
      writeFileSync(resolve(directory, "nested", "child.test.ts"), "");

      expect(discoverE2eFiles(directory)).toEqual(["nested/child.test.ts", "root.test.ts"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("extracts referenced E2E scripts from aggregate commands", () => {
    expect(referencedE2eScripts(
      "pnpm test:e2e:parity && pnpm test:e2e:editor:interaction",
    )).toEqual(["test:e2e:parity", "test:e2e:editor:interaction"]);
  });

  it("rejects missing E2E script references", () => {
    expect(() => reachableE2eScripts({
      "test:e2e": "pnpm test:e2e:missing",
    }, "test:e2e")).toThrow(/missing.*test:e2e:missing/i);
  });

  it("rejects cycles in the E2E script graph", () => {
    expect(() => reachableE2eScripts({
      "test:e2e": "pnpm test:e2e:parity",
      "test:e2e:parity": "pnpm test:e2e",
    }, "test:e2e")).toThrow(/cycle/i);
  });

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

  it("keeps every E2E leaf group reachable from the full root", () => {
    const reachable = reachableE2eScripts(manifest.scripts, "test:e2e");
    expect(
      leafGroups.map(([name]) => name).filter((name) => !reachable.has(name)),
      "every E2E leaf group must be reachable from test:e2e",
    ).toEqual([]);
  });

  it("uses automatic ports for every E2E render host", () => {
    expect(
      e2eFiles.filter((file) => /startWebServer\(\s*\d/.test(
        readFileSync(resolve(root, "e2e", file), "utf8"),
      )),
      "E2E servers must use automatic ports",
    ).toEqual([]);
  });
});
