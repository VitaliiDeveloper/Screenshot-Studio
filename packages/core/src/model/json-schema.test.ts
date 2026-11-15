// SPDX-License-Identifier: Apache-2.0
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { projectJsonSchema } from "./json-schema.js";
import { Project } from "./schema.js";

type ProjectInput = z.input<typeof Project>;

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const validate = new Ajv2020({ allErrors: true }).compile(projectJsonSchema());

async function projectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return projectFiles(path);
    return entry.name === "app-store-screenshots.json" ? [path] : [];
  }));
  return nested.flat().sort();
}

async function sampleProject(fixture = "sample"): Promise<ProjectInput> {
  return JSON.parse(await readFile(join(repoRoot, "fixtures", fixture, "app-store-screenshots.json"), "utf8"));
}

function firstScreen(project: ProjectInput) {
  return project.layouts[0]!.screens[0]!;
}

function firstGroup(project: ProjectInput) {
  const group = firstScreen(project).elements.find((element) => element.type === "group");
  if (group?.type !== "group") throw new Error("fixture has no group on its first screen");
  return group;
}

function objectNodesWithoutStrictness(node: unknown, path = "#"): string[] {
  if (!node || typeof node !== "object") return [];
  const record = node as Record<string, unknown>;
  const own = "properties" in record && record.additionalProperties !== false ? [path] : [];
  return [...own, ...Object.entries(record).flatMap(([key, child]) => objectNodesWithoutStrictness(child, `${path}/${key}`))];
}

describe("projectJsonSchema", () => {
  it("is deterministic", () => {
    expect(JSON.stringify(projectJsonSchema())).toBe(JSON.stringify(projectJsonSchema()));
  });

  it("names the repeated element and background unions once as $defs", () => {
    const schema = projectJsonSchema() as { $defs?: Record<string, unknown> };
    expect(Object.keys(schema.$defs ?? {})).toEqual(expect.arrayContaining(["Element", "LeafElement", "TextElement", "GroupElement", "Background"]));
  });

  it("keeps every object strict, like the zod schema", () => {
    expect(objectNodesWithoutStrictness(projectJsonSchema())).toEqual([]);
  });

  it("accepts every tracked fixture and example project", async () => {
    const paths = [
      ...await projectFiles(join(repoRoot, "fixtures")),
      ...await projectFiles(join(repoRoot, "examples")),
    ];
    expect(paths.length).toBeGreaterThan(0);
    const failures = [];
    for (const path of paths) {
      if (!validate(JSON.parse(await readFile(path, "utf8")))) {
        failures.push({ path: relative(repoRoot, path), errors: validate.errors });
      }
    }
    expect(failures).toEqual([]);
  });

  it("accepts a document that omits defaulted fields, as the file on disk may", async () => {
    const project = await sampleProject();
    delete project.fonts;
    delete project.layouts[0]!.screens[0]!.direction;
    expect(Project.safeParse(project).success).toBe(true);
    expect(validate(project)).toBe(true);
  });

  it.each<[string, string, (project: ProjectInput) => void]>([
    ["an unknown root key", "sample", (project) => { Object.assign(project, { $schema: "./schema.json" }); }],
    ["an unknown element key", "sample", (project) => { Object.assign(firstScreen(project).elements[0]!, { shadowColor: "#000" }); }],
    ["a wrong type", "sample", (project) => { Object.assign(project.meta, { schemaVersion: "1" }); }],
    ["a missing required field", "sample", (project) => { delete (project as Partial<ProjectInput>).preferredExportLayoutId; }],
    ["a device outside its platform", "sample", (project) => { Object.assign(firstScreen(project), { device: "phone" }); }],
    ["an unknown background key", "sample", (project) => { Object.assign(firstScreen(project).background, { opacity: 0.5 }); }],
    ["an unknown background type", "sample", (project) => { Object.assign(firstScreen(project).background, { type: "radial-gradient" }); }],
    ["a background colour of the wrong type", "sample", (project) => { Object.assign(firstScreen(project).background, { color: 0x0b1020 }); }],
    ["an invalid hex colour", "sample", (project) => { Object.assign(firstScreen(project).elements[0]!, { fill: "#12345" }); }],
    ["a font weight of the wrong type", "sample", (project) => { Object.assign(project.fonts![0]!, { weight: "400" }); }],
    ["an unknown screen set policy mode", "sample", (project) => {
      Object.assign(project.layouts[0]!.screenSetPolicies![0]!, { mode: "mirrored" });
    }],
    ["an unknown key in a group child", "regressions/group-parity", (project) => {
      Object.assign(firstGroup(project).children[0]!, { shadowColor: "#000" });
    }],
    ["a group nested in a group", "regressions/group-parity", (project) => {
      const group = firstGroup(project);
      group.children.push({ ...group, id: "nested-group" } as never);
    }],
    ["a non-numeric Apple app id", "publishing", (project) => { Object.assign(project.publishing!.apple!, { appId: "app-123" }); }],
    ["an unknown publishing store", "publishing", (project) => { Object.assign(project.publishing!, { amazon: { appId: "1" } }); }],
  ])("rejects %s (%s), as the zod schema does", async (_name, fixture, mutate) => {
    const project = await sampleProject(fixture);
    mutate(project);
    expect(Project.safeParse(project).success).toBe(false);
    expect(validate(project)).toBe(false);
  });

  it.each([
    ["a duplicate screen id", (project: ProjectInput) => {
      const screens = project.layouts[0]!.screens;
      screens.push({ ...screens[0]! });
    }],
    ["a dangling preferred export layout", (project: ProjectInput) => { project.preferredExportLayoutId = "missing"; }],
    ["a non-portable asset path", (project: ProjectInput) => { project.fonts![0]!.path = "/Users/me/font.ttf"; }],
  ])("leaves %s to screenshots check, because JSON Schema cannot express it", async (_name, mutate) => {
    const project = await sampleProject();
    mutate(project);
    expect(Project.safeParse(project).success).toBe(false);
    expect(validate(project)).toBe(true);
  });
});
