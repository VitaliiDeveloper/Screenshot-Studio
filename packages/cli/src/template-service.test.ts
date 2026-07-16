// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { updateProjectFile } from "./project-io.js";
import {
  createTemplateScreen,
  listTemplates,
  loadTemplate,
  TemplateValidationError,
} from "./template-service.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(directory);
  return directory;
}

async function fixture() {
  const dir = await temporaryDirectory("template-service-");
  const projectPath = join(dir, "app-store-screenshots.json");
  const template = {
    id: "accent-card", name: "Accent card", platform: "apple", device: "iphone",
    artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#111111" },
    elements: [{ id: "accent", type: "shape", role: "accent", x: 20, y: 20, width: 620, height: 20, rotation: 0, opacity: 1, locked: false, visible: true, kind: "rect", fill: "#38BDF8", radius: 10 }],
  };
  await mkdir(join(dir, "templates"));
  await writeFile(projectPath, JSON.stringify({
    meta: { name: "Templates", schemaVersion: 1 }, mode: "isolated", platforms: ["apple"], locales: ["en"], fonts: [],
    screens: [{ id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en", artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#000000" }, elements: [] }],
  }));
  await writeFile(join(dir, "templates/accent-card.json"), JSON.stringify(template));
  return { dir, projectPath, template };
}

describe("template-service", () => {
  it("lists definitions in stable id order", async () => {
    const { dir, projectPath, template } = await fixture();
    await writeFile(join(dir, "templates/blank.json"), JSON.stringify({ ...template, id: "blank", name: "Blank" }));
    expect((await listTemplates(projectPath)).map((item) => item.id)).toEqual(["accent-card", "blank"]);
  });

  it("rejects mismatched filenames and ids", async () => {
    const { dir, projectPath, template } = await fixture();
    await writeFile(join(dir, "templates/wrong.json"), JSON.stringify({ ...template, id: "other" }));
    await expect(listTemplates(projectPath)).rejects.toBeInstanceOf(TemplateValidationError);
  });

  it("creates and persists a screen", async () => {
    const { projectPath } = await fixture();
    const result = await createTemplateScreen(projectPath, "accent-card", "uk");
    expect(result.screen).toMatchObject({ id: "accent-card", locale: "uk" });
    const saved = JSON.parse(await readFile(projectPath, "utf8"));
    expect(saved.screens).toHaveLength(2);
    expect(saved.locales).toEqual(["en", "uk"]);
  });

  it("resolves list, load, and create resources beside a symlinked project target", async () => {
    const { projectPath } = await fixture();
    const aliasDir = await temporaryDirectory("template-service-alias-");
    const aliasPath = join(aliasDir, "project-alias.json");
    await symlink(projectPath, aliasPath);

    expect((await listTemplates(aliasPath)).map((template) => template.id)).toEqual(["accent-card"]);
    await expect(loadTemplate(aliasPath, "accent-card"))
      .resolves.toMatchObject({ name: "Accent card" });
    await createTemplateScreen(aliasPath, "accent-card", "uk");

    const saved = JSON.parse(await readFile(projectPath, "utf8"));
    expect(saved.screens).toHaveLength(2);
    expect(saved.locales).toEqual(["en", "uk"]);
  });

  it("queues create behind the project lease while list remains lock-free", async () => {
    const { projectPath } = await fixture();
    let releaseHeld!: () => void;
    const heldMayFinish = new Promise<void>((resolve) => { releaseHeld = resolve; });
    let heldEntered!: () => void;
    const heldDidEnter = new Promise<void>((resolve) => { heldEntered = resolve; });

    const held = updateProjectFile(projectPath, async (project) => {
      heldEntered();
      await heldMayFinish;
      return {
        project: { ...project, meta: { ...project.meta, name: "Held writer" } },
        value: undefined,
      };
    });
    const heldOutcome = held.then(
      () => ({ status: "fulfilled" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    await heldDidEnter;
    await expect(listTemplates(projectPath)).resolves.toHaveLength(1);

    const create = createTemplateScreen(projectPath, "accent-card", "uk");
    const createOutcome = create.then(
      (value) => ({ status: "fulfilled" as const, value }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    const queueState = await Promise.race([
      createOutcome.then(() => "settled" as const),
      new Promise<"waited">((resolve) => setTimeout(() => resolve("waited"), 100)),
    ]);

    releaseHeld();
    const heldResult = await heldOutcome;
    const createResult = await createOutcome;

    expect(queueState).toBe("waited");
    expect(heldResult.status).toBe("fulfilled");
    expect(createResult.status).toBe("fulfilled");
    const saved = JSON.parse(await readFile(projectPath, "utf8"));
    expect(saved.meta.name).toBe("Held writer");
    expect(saved.screens).toHaveLength(2);
    expect(saved.locales).toEqual(["en", "uk"]);
  });
});
