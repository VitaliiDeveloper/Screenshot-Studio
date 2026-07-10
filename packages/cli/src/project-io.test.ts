import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { Project } from "@screenshot-studio/core/model";
import { loadProjectFile, writeProjectFile } from "./project-io.js";

function sampleProject(): Project {
  return {
    meta: { name: "CLI Project", schemaVersion: 2 },
    mode: "isolated",
    platforms: ["apple"],
    locales: ["en"],
    fonts: [],
    screens: [
      {
        id: "hero",
        name: "Hero",
        platform: "apple",
        device: "iphone",
        locale: "en",
        direction: "ltr",
        artboard: { width: 1320, height: 2868 },
        background: { type: "solid", color: "#101827" },
        elements: [],
      },
    ],
  };
}

describe("project IO", () => {
  it("loads a strict project JSON file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "screenshot-studio-project-io-"));
    const projectPath = join(dir, "app-store-screenshots.json");
    const project = sampleProject();
    await writeFile(projectPath, JSON.stringify(project), "utf8");

    await expect(loadProjectFile(projectPath)).resolves.toEqual(project);
  });

  it("writes pretty project JSON with a trailing newline", async () => {
    const dir = await mkdtemp(join(tmpdir(), "screenshot-studio-project-io-"));
    const projectPath = join(dir, "app-store-screenshots.json");

    await writeProjectFile(projectPath, sampleProject());

    const text = await readFile(projectPath, "utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(text).toContain('  "screens": [');
    await expect(loadProjectFile(projectPath)).resolves.toEqual(sampleProject());
  });
});
