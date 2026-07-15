// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { Project } from "@screenshot-studio/core/model";
import {
  DEFAULT_PROJECT_FILENAME,
  loadProjectFile,
  loadProjectSnapshot,
  resolveProjectPath,
  updateProjectFile,
  writeProjectFile,
} from "./project-io.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "screenshot-studio-project-io-"));
  temporaryRoots.push(directory);
  return directory;
}

function sampleProject(): Project {
  return {
    meta: { name: "CLI Project", schemaVersion: 1 },
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
  it("resolves the canonical project filename by default", () => {
    expect(DEFAULT_PROJECT_FILENAME).toBe("app-store-screenshots.json");
    expect(resolveProjectPath({})).toBe(resolve(DEFAULT_PROJECT_FILENAME));
  });

  it("loads a strict project JSON file", async () => {
    const dir = await temporaryDirectory();
    const projectPath = join(dir, "app-store-screenshots.json");
    const project = sampleProject();
    await writeFile(projectPath, JSON.stringify(project), "utf8");

    await expect(loadProjectFile(projectPath)).resolves.toEqual(project);
  });

  it("writes pretty project JSON with a trailing newline", async () => {
    const dir = await temporaryDirectory();
    const projectPath = join(dir, "app-store-screenshots.json");

    await writeProjectFile(projectPath, sampleProject());

    const text = await readFile(projectPath, "utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(text).toContain('  "screens": [');
    await expect(loadProjectFile(projectPath)).resolves.toEqual(sampleProject());
  });

  it("loads a project together with its exact persisted revision", async () => {
    const dir = await temporaryDirectory();
    const projectPath = join(dir, "app-store-screenshots.json");
    await writeProjectFile(projectPath, sampleProject());

    const snapshot = await loadProjectSnapshot(projectPath);
    expect(snapshot.project).toEqual(sampleProject());
    expect(snapshot.revision).toMatch(/^[a-f0-9]{64}$/);
  });

  it("serializes concurrent read-modify-write operations without losing either change", async () => {
    const dir = await temporaryDirectory();
    const projectPath = join(dir, "app-store-screenshots.json");
    await writeProjectFile(projectPath, sampleProject());

    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstEntered!: () => void;
    const firstDidEnter = new Promise<void>((resolve) => { firstEntered = resolve; });

    const first = updateProjectFile(projectPath, async (project) => {
      firstEntered();
      await firstMayFinish;
      return {
        project: { ...project, meta: { ...project.meta, name: "First mutation" } },
        value: "first",
      };
    });
    await firstDidEnter;

    let secondEntered = false;
    const second = updateProjectFile(projectPath, (project) => {
      secondEntered = true;
      return {
        project: {
          ...project,
          screens: project.screens.map((screen, index) => index === 0
            ? { ...screen, background: { type: "solid" as const, color: "#000000" } }
            : screen),
        },
        value: "second",
      };
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(secondEntered).toBe(false);

    releaseFirst();
    await first;
    const secondResult = await second;

    expect(secondResult.value).toBe("second");
    expect(secondResult.revision).toMatch(/^[a-f0-9]{64}$/);
    const final = await loadProjectFile(projectPath);
    expect(final.meta.name).toBe("First mutation");
    expect(final.screens[0]!.background).toEqual({ type: "solid", color: "#000000" });
  });
});
