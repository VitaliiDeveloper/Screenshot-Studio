// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseProjectJson } from "@screenshot-studio/core/model";
import { runInit } from "./init.js";

describe("runInit", () => {
  it("creates a valid project, standard directories, and agent workflow guides", async () => {
    const dir = await mkdtemp(join(tmpdir(), "screenshot-studio-init-"));

    await runInit(dir, "Launch Deck");

    const project = parseProjectJson(await readFile(join(dir, "app-store-screenshots.json"), "utf8"));
    expect(project.meta.name).toBe("Launch Deck");
    expect(project).toMatchObject({ mode: "isolated", meta: { schemaVersion: 6 } });
    expect(project.screens).toHaveLength(1);
    expect(project.screens[0]!.artboard).toEqual({ width: 1320, height: 2868 });

    for (const path of [
      "screenshots/apple/iphone/en",
      "assets/fonts",
      "assets/icons",
      "themes",
      "templates",
      "export",
    ]) {
      expect((await stat(join(dir, path))).isDirectory()).toBe(true);
    }

    const agentGuide = await readFile(join(dir, "AGENTS.md"), "utf8");
    expect(agentGuide).toContain("strict v6 JSON");
    expect(agentGuide).toContain("mode: isolated | connected");
    expect(agentGuide).toContain("## Recipe: generate or refresh copy");
    expect(agentGuide).toContain("## Recipe: lay out slides");
    expect(agentGuide).toContain("## Recipe: translate a locale");
    expect(agentGuide).toContain("screenshots locale add ar --from en --direction rtl");
    expect(agentGuide).toContain("## Recipe: process a local asset");
    expect(agentGuide).toContain("screenshots asset auto-crop");
    expect(agentGuide).toContain("screenshots asset remove-background");

    await expect(readFile(join(dir, "CLAUDE.md"), "utf8")).resolves.toContain("@AGENTS.md");
  });

  it("refuses to overwrite an existing agent control file before writing the project", async () => {
    const dir = await mkdtemp(join(tmpdir(), "screenshot-studio-init-conflict-"));
    const existingGuide = "# Existing project instructions\n";
    await writeFile(join(dir, "AGENTS.md"), existingGuide, "utf8");

    await expect(runInit(dir)).rejects.toThrow(/Refusing to overwrite existing .*AGENTS\.md/);
    await expect(readFile(join(dir, "AGENTS.md"), "utf8")).resolves.toBe(existingGuide);
    await expect(readFile(join(dir, "app-store-screenshots.json"), "utf8")).rejects.toThrow();
  });

  it("keeps the existing project-file overwrite guard", async () => {
    const dir = await mkdtemp(join(tmpdir(), "screenshot-studio-init-project-conflict-"));
    const existingProject = "{}\n";
    await writeFile(join(dir, "app-store-screenshots.json"), existingProject, "utf8");

    await expect(runInit(dir)).rejects.toThrow(/Refusing to overwrite existing .*app-store-screenshots\.json/);
    await expect(readFile(join(dir, "app-store-screenshots.json"), "utf8")).resolves.toBe(existingProject);
    await expect(readFile(join(dir, "AGENTS.md"), "utf8")).rejects.toThrow();
  });
});
